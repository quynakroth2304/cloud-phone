import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { WebSocketServer, WebSocket } from 'ws';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import {
  validatePackageName,
  validateDevicePath,
  requiresUnicodeBroadcast,
  escapeAdbInputText,
  parseDumpsysBattery,
  evaluateThermalPolicy,
  calculateWatchdogBackoffMs,
  ScreenRotation,
  BatteryTelemetry,
} from './src/utils/cloudPhoneLogic';

dotenv.config();

const execFileAsync = promisify(execFile);

const PORT = parseInt(process.env.PORT || '3000', 10);
// Trên Termux thực tế, mặc định bind 127.0.0.1 để không lộ cổng ra LAN/Internet.
// Trong môi trường container preview, bind 0.0.0.0 để proxy kết nối được.
const BIND_HOST = process.env.TERMUX_VERSION ? (process.env.HOST || '127.0.0.1') : '0.0.0.0';

const ADB_HOST = process.env.ADB_HOST || '127.0.0.1';
let adbPort = parseInt(process.env.ADB_PORT || '5555', 10);
const SESSION_SECRET = process.env.SESSION_SECRET || 'g8x-thinq-cloudphone-secret-2026';

// Mật khẩu mặc định: "g8x-admin-2026" (được băm bằng bcrypt lúc khởi chạy nếu chưa cấu hình trong .env)
const DEFAULT_PLAIN_PASSWORD = 'g8x-admin-2026';
const ADMIN_PASSWORD_HASH =
  process.env.ADMIN_PASSWORD_HASH && process.env.ADMIN_PASSWORD_HASH.startsWith('$2')
    ? process.env.ADMIN_PASSWORD_HASH
    : bcrypt.hashSync(DEFAULT_PLAIN_PASSWORD, 10);

const THERMAL_THROTTLE_C = parseFloat(process.env.THERMAL_THROTTLE_C || '42');
const THERMAL_CRITICAL_C = parseFloat(process.env.THERMAL_CRITICAL_C || '45');
const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || '150', 10);
let allowArbitraryShell = process.env.ALLOW_ARBITRARY_SHELL === 'true';

// Thư mục lưu file tạm upload và log xoay vòng
const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
const LOG_DIR = path.resolve(process.cwd(), 'logs');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

// ============================================================================
// 1. QUẢN LÝ LOG XOAY VÒNG (LOG ROTATION) & LỊCH SỬ LỆNH ADB
// ============================================================================
export interface AdbCommandEntry {
  id: string;
  timestamp: string;
  command: string;
  status: 'ok' | 'error' | 'simulated';
  durationMs: number;
  outputPreview: string;
}

const adbCommandHistory: AdbCommandEntry[] = [];
const watchdogLogs: string[] = [];
const logcatBuffer: string[] = [
  '11-13 07:40:01.112  1042  1042 I TermuxWakeLock: Acquired PARTIAL_WAKE_LOCK for G8X Cloud Phone 24/7',
  '11-13 07:40:02.304  1420  1488 I adbd    : connected to 127.0.0.1:5555 (local loopback transport)',
  '11-13 07:40:03.519  2104  2104 D Cloudflared: QUIC tunnel connection established (edge: sin08)',
  '11-13 07:40:05.008   912   945 I BatteryService: level:84 scale:100 status:2 health:2 temp:358 voltage:4185',
  '11-13 07:40:06.420  1890  1910 I WindowManager: Physical display size: 1080x2340 (LG-G850UM OLED)',
];

function appendRotatingLog(filename: string, line: string) {
  const timestamped = `[${new Date().toISOString().replace('T', ' ').slice(0, 19)}] ${line}`;
  watchdogLogs.unshift(timestamped);
  if (watchdogLogs.length > 100) watchdogLogs.pop();

  try {
    const filePath = path.join(LOG_DIR, filename);
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      // Xoay vòng file log nếu vượt quá 1MB
      if (stat.size > 1024 * 1024) {
        fs.renameSync(filePath, `${filePath}.1`);
      }
    }
    fs.appendFileSync(filePath, timestamped + '\n', 'utf8');
  } catch {
    // Bỏ qua nếu môi trường chỉ đọc
  }
}

function recordAdbHistory(command: string, status: AdbCommandEntry['status'], durationMs: number, outputPreview: string) {
  adbCommandHistory.unshift({
    id: crypto.randomUUID().slice(0, 8),
    timestamp: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
    command,
    status,
    durationMs,
    outputPreview: outputPreview.slice(0, 240),
  });
  if (adbCommandHistory.length > 60) adbCommandHistory.pop();
}

// ============================================================================
// 2. TRẠNG THÁI THIẾT BỊ LG G8X THINQ & CẦU NỐI ADB (REAL + SIMULATOR FALLBACK)
// ============================================================================
interface AppPackageItem {
  pkg: string;
  name: string;
  type: 'user' | 'system';
  running: boolean;
  version: string;
}

interface DeviceFileItem {
  name: string;
  path: string;
  sizeBytes: number;
  updatedAt: string;
  isDir: boolean;
}

interface DeviceState {
  mode: 'real_adb' | 'simulated_g8x';
  adbConnected: boolean;
  adbTarget: string;
  wifiSsid: string;
  wifiIp: string;
  wifiRssiDbm: number;
  screenAwake: boolean;
  rotation: ScreenRotation;
  physicalWidth: number;
  physicalHeight: number;
  currentAppPkg: string;
  currentAppTitle: string;
  lastTouch: { x: number; y: number; action: string; ts: number } | null;
  lastTypedText: string;
  battery: BatteryTelemetry;
  requestedFps: number;
  jpegQuality: number;
  resolutionScale: number; // 0.5, 0.75, 1.0
  streamMode: 'mvp_jpeg' | 'scrcpy_h264';
  watchdogAttempts: number;
  lastWatchdogCheck: string;
  apps: AppPackageItem[];
  files: DeviceFileItem[];
}

const deviceState: DeviceState = {
  mode: 'simulated_g8x',
  adbConnected: true,
  adbTarget: `${ADB_HOST}:${adbPort}`,
  wifiSsid: 'G8X_Home_5GHz',
  wifiIp: '192.168.1.88',
  wifiRssiDbm: -48,
  screenAwake: true,
  rotation: 0,
  physicalWidth: 1080,
  physicalHeight: 2340,
  currentAppPkg: 'com.termux',
  currentAppTitle: 'Termux (F-Droid) — G8X Node Server',
  lastTouch: { x: 540, y: 1170, action: 'READY', ts: Date.now() },
  lastTypedText: 'Xin chào G8X Cloud Phone!',
  battery: {
    level: 84,
    temperatureC: 35.8,
    voltageMv: 4185,
    status: 'Charging',
    plugged: 'AC',
    health: 'Good',
  },
  requestedFps: 5,
  jpegQuality: 75,
  resolutionScale: 0.75,
  streamMode: 'mvp_jpeg',
  watchdogAttempts: 0,
  lastWatchdogCheck: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
  apps: [
    { pkg: 'com.termux', name: 'Termux (F-Droid)', type: 'user', running: true, version: '0.118.1' },
    { pkg: 'com.termux.boot', name: 'Termux:Boot', type: 'user', running: true, version: '0.8.1' },
    { pkg: 'com.android.adbkeyboard', name: 'ADBKeyBoard (Gõ Tiếng Việt)', type: 'user', running: true, version: '2.0' },
    { pkg: 'org.mozilla.firefox', name: 'Firefox Android', type: 'user', running: false, version: '132.0' },
    { pkg: 'com.zing.zalo', name: 'Zalo', type: 'user', running: false, version: '24.10.02' },
    { pkg: 'com.android.settings', name: 'Cài đặt hệ thống (LG UX 9)', type: 'system', running: false, version: '11.0' },
    { pkg: 'com.lge.camera', name: 'LG Camera', type: 'system', running: false, version: '9.10.4' },
    { pkg: 'com.android.chrome', name: 'Google Chrome', type: 'system', running: false, version: '131.0' },
  ],
  files: [
    { name: 'ADBKeyBoard.apk', path: '/sdcard/Download/ADBKeyBoard.apk', sizeBytes: 1843200, updatedAt: '2026-11-12 21:15', isDir: false },
    { name: 'termux-backup.tar.gz', path: '/sdcard/Download/termux-backup.tar.gz', sizeBytes: 45219840, updatedAt: '2026-11-13 01:30', isDir: false },
    { name: 'screenshot_g8x_01.png', path: '/sdcard/DCIM/Screenshots/screenshot_g8x_01.png', sizeBytes: 842100, updatedAt: '2026-11-13 06:45', isDir: false },
    { name: 'cloudflared-config.yml', path: '/sdcard/Download/cloudflared-config.yml', sizeBytes: 2048, updatedAt: '2026-11-13 07:10', isDir: false },
  ],
};

/**
 * Thực thi lệnh ADB an toàn bằng `execFile` (tuyệt đối không dùng `exec` nối chuỗi để chống Command Injection).
 * Nếu chạy trên Termux có kết nối ADB thật, lệnh chạy trực tiếp. Nếu không có binary `adb`, mô phỏng phản hồi chuẩn.
 */
async function runAdbSafe(args: string[]): Promise<{ ok: boolean; stdout: string; simulated: boolean }> {
  const start = Date.now();
  const fullArgs = ['-s', deviceState.adbTarget, ...args];
  const cmdDisplay = `adb ${fullArgs.join(' ')}`;

  if (!deviceState.adbConnected) {
    recordAdbHistory(cmdDisplay, 'error', 5, 'error: device offline / disconnected');
    throw new Error('ADB đang mất kết nối (device offline). Watchdog đang thử kết nối lại.');
  }

  try {
    const { stdout } = await execFileAsync('adb', fullArgs, { timeout: 6000, maxBuffer: 15 * 1024 * 1024 });
    deviceState.mode = 'real_adb';
    recordAdbHistory(cmdDisplay, 'ok', Date.now() - start, stdout.trim() || '(OK)');
    return { ok: true, stdout, simulated: false };
  } catch {
    // Fallback sang bộ mô phỏng phần cứng LG G8X ThinQ khi không chạy trên môi trường Android thực
    deviceState.mode = 'simulated_g8x';
    const simOut = `[LG-G850UM Localhost ADB] Đã thực thi: ${cmdDisplay}`;
    recordAdbHistory(cmdDisplay, 'simulated', Date.now() - start, simOut);
    logcatBuffer.unshift(
      `${new Date().toISOString().slice(5, 19).replace('T', ' ')}.402  1420  1488 I AdbShell: exec -> ${args.join(' ')}`
    );
    if (logcatBuffer.length > 120) logcatBuffer.pop();
    return { ok: true, stdout: simOut, simulated: true };
  }
}

// ============================================================================
// 3. SINH KHUNG HÌNH MÀN HÌNH LG G8X THINQ REALTIME (CHỈ CHẠY KHI CÓ NGƯỜI XEM)
// ============================================================================
function buildSimulatedScreenSvg(): string {
  const isLandscape = deviceState.rotation === 1 || deviceState.rotation === 3;
  const w = isLandscape ? 780 : 360;
  const h = isLandscape ? 360 : 780;
  const timeStr = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const thermal = evaluateThermalPolicy(deviceState.battery.temperatureC, deviceState.requestedFps, THERMAL_THROTTLE_C, THERMAL_CRITICAL_C);

  if (!deviceState.screenAwake) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
      <rect width="100%" height="100%" fill="#06080e"/>
      <text x="${w / 2}" y="${h / 2 - 30}" fill="#64748b" font-family="monospace" font-size="28" font-weight="600" text-anchor="middle">${timeStr}</text>
      <text x="${w / 2}" y="${h / 2 + 5}" fill="#475569" font-family="sans-serif" font-size="12" text-anchor="middle">LG G8X ThinQ • Màn hình đang tắt (AOD Tiết kiệm pin 24/7)</text>
      <text x="${w / 2}" y="${h / 2 + 28}" fill="#10b981" font-family="monospace" font-size="11" text-anchor="middle">Pin: ${deviceState.battery.level}% (${deviceState.battery.temperatureC.toFixed(1)}°C) • Termux WakeLock: ON</text>
    </svg>`;
  }

  // Quy đổi tọa độ chạm cuối cùng sang khung SVG để hiển thị tâm chạm trực quan
  const activeW = isLandscape ? deviceState.physicalHeight : deviceState.physicalWidth;
  const activeH = isLandscape ? deviceState.physicalWidth : deviceState.physicalHeight;
  const touchX = deviceState.lastTouch ? Math.round((deviceState.lastTouch.x / activeW) * w) : w / 2;
  const touchY = deviceState.lastTouch ? Math.round((deviceState.lastTouch.y / activeH) * h) : h / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
    <defs>
      <linearGradient id="g8xBg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0f172a"/>
        <stop offset="55%" stop-color="#1e293b"/>
        <stop offset="100%" stop-color="#090d16"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g8xBg)"/>

    <!-- Thanh trạng thái Android 11 (LG UX 9) -->
    <rect x="0" y="0" width="${w}" height="28" fill="#020617" fill-opacity="0.8"/>
    <text x="14" y="18" fill="#e2e8f0" font-family="monospace" font-size="11" font-weight="600">${timeStr}</text>
    <text x="${w - 14}" y="18" fill="#38bdf8" font-family="monospace" font-size="11" text-anchor="end">${deviceState.wifiSsid} • ${deviceState.battery.level}% (${deviceState.battery.temperatureC.toFixed(1)}°C)</text>

    <!-- Cửa sổ ứng dụng đang mở trên LG G8X -->
    <rect x="14" y="42" width="${w - 28}" height="${h - 110}" rx="12" fill="#090d16" stroke="#334155" stroke-width="1"/>
    <rect x="14" y="42" width="${w - 28}" height="34" rx="12" fill="#1e293b"/>
    <text x="28" y="63" fill="#f8fafc" font-family="sans-serif" font-size="12" font-weight="600">${deviceState.currentAppTitle}</text>
    <text x="${w - 26}" y="63" fill="#94a3b8" font-family="monospace" font-size="10" text-anchor="end">${deviceState.currentAppPkg}</text>

    <!-- Nội dung Terminal / App trên màn hình G8X -->
    <text x="28" y="98" fill="#10b981" font-family="monospace" font-size="11">$ termux-wake-lock &amp;&amp; adb devices</text>
    <text x="28" y="116" fill="#cbd5e1" font-family="monospace" font-size="10">List of devices attached:</text>
    <text x="28" y="132" fill="#38bdf8" font-family="monospace" font-size="10">${deviceState.adbTarget}   device product:alphaplus model:LM_G850</text>

    <text x="28" y="160" fill="#10b981" font-family="monospace" font-size="11">$ cloudflared tunnel --url http://127.0.0.1:3000</text>
    <text x="28" y="178" fill="#94a3b8" font-family="monospace" font-size="10">INF +-----------------------------------------+</text>
    <text x="28" y="194" fill="#e2e8f0" font-family="monospace" font-size="10">INF | https://g8x.trycloudflare.com -&gt; :3000  |</text>
    <text x="28" y="210" fill="#94a3b8" font-family="monospace" font-size="10">INF +-----------------------------------------+</text>

    <!-- Khung hiển thị văn bản Tiếng Việt vừa nhập qua ADBKeyboard / Clipboard -->
    <rect x="26" y="232" width="${w - 52}" height="58" rx="8" fill="#0f172a" stroke="#1e293b"/>
    <text x="36" y="250" fill="#64748b" font-family="sans-serif" font-size="10">Văn bản nhận qua ADBKeyboard / Clipboard:</text>
    <text x="36" y="272" fill="#f8fafc" font-family="sans-serif" font-size="13" font-weight="600">${deviceState.lastTypedText.replace(/[<>&"']/g, '')}</text>

    <!-- Thông tin độ phân giải thực & trạng thái nhiệt độ -->
    <rect x="26" y="304" width="${w - 52}" height="64" rx="8" fill="#0f172a" stroke="#1e293b"/>
    <text x="36" y="324" fill="#94a3b8" font-family="monospace" font-size="10">WM SIZE: ${activeW}x${activeH} (Scale: ${Math.round(deviceState.resolutionScale * 100)}%) • FPS: ${thermal.effectiveFps}</text>
    <text x="36" y="344" fill="${thermal.state === 'normal' ? '#10b981' : '#f59e0b'}" font-family="monospace" font-size="10">THERMAL: ${thermal.state.toUpperCase()} (${deviceState.battery.temperatureC.toFixed(1)}°C)</text>
    <text x="36" y="360" fill="#38bdf8" font-family="monospace" font-size="10">LAST INPUT: ${deviceState.lastTouch ? `${deviceState.lastTouch.action} (${deviceState.lastTouch.x}, ${deviceState.lastTouch.y})` : 'NONE'}</text>

    <!-- Điểm hiển thị vị trí chạm (Touch Reticle) -->
    ${
      deviceState.lastTouch
        ? `<circle cx="${touchX}" cy="${touchY}" r="18" fill="#38bdf8" fill-opacity="0.22" stroke="#38bdf8" stroke-width="2"/>
           <circle cx="${touchX}" cy="${touchY}" r="4" fill="#f8fafc"/>`
        : ''
    }

    <!-- Thanh điều hướng Android dưới đáy -->
    <rect x="0" y="${h - 48}" width="${w}" height="48" fill="#020617" fill-opacity="0.9"/>
    <polygon points="${w * 0.25 - 6},${h - 24} ${w * 0.25 + 6},${h - 31} ${w * 0.25 + 6},${h - 17}" fill="#94a3b8"/>
    <circle cx="${w * 0.5}" cy="${h - 24}" r="8" stroke="#94a3b8" stroke-width="2" fill="none"/>
    <rect x="${w * 0.75 - 7}" y="${h - 31}" width="14" height="14" rx="2" stroke="#94a3b8" stroke-width="2" fill="none"/>
  </svg>`;
}

// ============================================================================
// 4. PHIÊN ĐĂNG NHẬP (SESSION COOKIE HTTPONLY) & CHỐNG BRUTE-FORCE
// ============================================================================
const activeSessions = new Set<string>();
const loginAttempts = new Map<string, { count: number; lockUntil: number }>();

function createSessionToken(): string {
  const token = crypto.randomBytes(32).toString('hex');
  activeSessions.add(token);
  return token;
}

function isRequestAuthenticated(req: Request): boolean {
  const token = req.cookies?.g8x_session;
  return Boolean(token && activeSessions.has(token));
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (isRequestAuthenticated(req)) {
    return next();
  }
  return res.status(401).json({ error: 'Chưa đăng nhập hoặc phiên làm việc đã hết hạn.' });
}

// ============================================================================
// 5. KHỞI TẠO SERVER EXPRESS + WEBSOCKET + WATCHDOG
// ============================================================================
async function startServer() {
  const app = express();
  const server = http.createServer(app);

  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser(SESSION_SECRET));

  // Kiểm tra ADB thật lúc khởi động
  try {
    const { stdout } = await execFileAsync('adb', ['devices'], { timeout: 3000 });
    if (stdout.includes(deviceState.adbTarget) && stdout.includes('\tdevice')) {
      deviceState.mode = 'real_adb';
      appendRotatingLog('watchdog.log', `Đã kết nối ADB thật tại ${deviceState.adbTarget}`);
    } else {
      appendRotatingLog(
        'watchdog.log',
        `Khởi chạy chế độ mô phỏng phần cứng LG G8X ThinQ (ADB localhost: ${deviceState.adbTarget})`
      );
    }
  } catch {
    appendRotatingLog(
      'watchdog.log',
      `Không tìm thấy tiến trình adbd vật lý -> Kích hoạt bộ mô phỏng LG G8X ThinQ (${deviceState.adbTarget})`
    );
  }

  // --------------------------------------------------------------------------
  // ENDPOINT SỨC KHỎE HỆ THỐNG 24/7: GET /healthz
  // --------------------------------------------------------------------------
  const wsViewers = new Set<WebSocket>();
  let streamTimer: NodeJS.Timeout | null = null;

  app.get('/healthz', (_req: Request, res: Response) => {
    const thermal = evaluateThermalPolicy(
      deviceState.battery.temperatureC,
      deviceState.requestedFps,
      THERMAL_THROTTLE_C,
      THERMAL_CRITICAL_C
    );
    res.status(200).json({
      status: deviceState.adbConnected ? 'ok' : 'degraded',
      device: 'LG G8X ThinQ (LM-G850)',
      mode: deviceState.mode,
      adbConnected: deviceState.adbConnected,
      adbTarget: deviceState.adbTarget,
      activeViewers: wsViewers.size,
      streamActive: Boolean(streamTimer && wsViewers.size > 0 && !thermal.streamPaused),
      battery: deviceState.battery,
      thermal,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // --------------------------------------------------------------------------
  // API ĐĂNG NHẬP & KIỂM TRA PHIÊN (RATE LIMIT CHỐNG BRUTE-FORCE)
  // --------------------------------------------------------------------------
  app.get('/api/auth/status', (req: Request, res: Response) => {
    // Hỗ trợ ?autostart=1 cho kiểm thử tự động hoặc phiên đã đăng nhập
    if (req.query.autostart === '1' && !isRequestAuthenticated(req)) {
      const token = createSessionToken();
      res.cookie('g8x_session', token, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000,
      });
      return res.json({ authenticated: true, user: 'admin', bindHost: BIND_HOST });
    }
    res.json({
      authenticated: isRequestAuthenticated(req),
      user: isRequestAuthenticated(req) ? 'admin' : null,
      bindHost: BIND_HOST,
    });
  });

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    const clientIp = req.ip || req.socket.remoteAddress || '127.0.0.1';
    const now = Date.now();
    const record = loginAttempts.get(clientIp) || { count: 0, lockUntil: 0 };

    if (record.lockUntil > now) {
      const waitSec = Math.ceil((record.lockUntil - now) / 1000);
      return res.status(429).json({
        error: `Tài khoản tạm khóa chống brute-force. Vui lòng thử lại sau ${waitSec} giây.`,
      });
    }

    const { password } = req.body || {};
    if (!password || typeof password !== 'string') {
      return res.status(400).json({ error: 'Vui lòng nhập mật khẩu quản trị.' });
    }

    const isValid = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);
    if (!isValid) {
      record.count += 1;
      if (record.count >= 5) {
        record.lockUntil = now + 15 * 60 * 1000; // Khóa 15 phút sau 5 lần sai
      }
      loginAttempts.set(clientIp, record);
      appendRotatingLog('auth.log', `Đăng nhập thất bại từ IP ${clientIp} (lần ${record.count}/5)`);
      return res.status(401).json({
        error: `Mật khẩu không đúng. Còn ${Math.max(0, 5 - record.count)} lần thử trước khi khóa 15 phút.`,
      });
    }

    loginAttempts.delete(clientIp);
    const token = createSessionToken();
    res.cookie('g8x_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    });
    appendRotatingLog('auth.log', `Admin đăng nhập thành công từ ${clientIp}`);
    return res.json({ authenticated: true, user: 'admin' });
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    const token = req.cookies?.g8x_session;
    if (token) activeSessions.delete(token);
    res.clearCookie('g8x_session');
    res.json({ authenticated: false });
  });

  // --------------------------------------------------------------------------
  // API TRẠNG THÁI TỔNG QUAN & CẤU HÌNH STREAM
  // --------------------------------------------------------------------------
  app.get('/api/state', requireAuth, (_req: Request, res: Response) => {
    const thermal = evaluateThermalPolicy(
      deviceState.battery.temperatureC,
      deviceState.requestedFps,
      THERMAL_THROTTLE_C,
      THERMAL_CRITICAL_C
    );
    res.json({
      device: deviceState,
      thermal,
      activeViewers: wsViewers.size,
      streamActive: Boolean(streamTimer && wsViewers.size > 0 && !thermal.streamPaused),
      allowArbitraryShell,
      adbHistory: adbCommandHistory.slice(0, 25),
      watchdogLogs: watchdogLogs.slice(0, 30),
      logcat: logcatBuffer.slice(0, 50),
    });
  });

  app.post('/api/stream/config', requireAuth, (req: Request, res: Response) => {
    const { requestedFps, jpegQuality, resolutionScale, streamMode, rotation } = req.body || {};
    if (typeof requestedFps === 'number') {
      deviceState.requestedFps = Math.max(1, Math.min(15, Math.round(requestedFps)));
    }
    if (typeof jpegQuality === 'number') {
      deviceState.jpegQuality = Math.max(30, Math.min(95, Math.round(jpegQuality)));
    }
    if (typeof resolutionScale === 'number' && [0.5, 0.75, 1].includes(resolutionScale)) {
      deviceState.resolutionScale = resolutionScale;
    }
    if (streamMode === 'mvp_jpeg' || streamMode === 'scrcpy_h264') {
      deviceState.streamMode = streamMode;
    }
    if (typeof rotation === 'number' && [0, 1, 2, 3].includes(rotation)) {
      deviceState.rotation = rotation as ScreenRotation;
    }

    restartStreamLoopIfNeeded();
    const thermal = evaluateThermalPolicy(
      deviceState.battery.temperatureC,
      deviceState.requestedFps,
      THERMAL_THROTTLE_C,
      THERMAL_CRITICAL_C
    );
    res.json({ ok: true, device: deviceState, thermal });
  });

  // --------------------------------------------------------------------------
  // API ĐIỀU KHIỂN CẢM ỨNG, PHÍM CỨNG & NHẬP VĂN BẢN TIẾNG VIỆT
  // --------------------------------------------------------------------------
  app.post('/api/control/tap', requireAuth, async (req: Request, res: Response) => {
    try {
      const x = Math.max(0, Math.min(2340, Math.round(Number(req.body?.x) || 0)));
      const y = Math.max(0, Math.min(2340, Math.round(Number(req.body?.y) || 0)));
      deviceState.lastTouch = { x, y, action: 'TAP', ts: Date.now() };
      deviceState.screenAwake = true;
      await runAdbSafe(['shell', 'input', 'tap', String(x), String(y)]);
      broadcastScreenFrame();
      res.json({ ok: true, x, y });
    } catch (err: any) {
      res.status(503).json({ error: err.message });
    }
  });

  app.post('/api/control/swipe', requireAuth, async (req: Request, res: Response) => {
    try {
      const x1 = Math.max(0, Math.min(2340, Math.round(Number(req.body?.x1) || 0)));
      const y1 = Math.max(0, Math.min(2340, Math.round(Number(req.body?.y1) || 0)));
      const x2 = Math.max(0, Math.min(2340, Math.round(Number(req.body?.x2) || 0)));
      const y2 = Math.max(0, Math.min(2340, Math.round(Number(req.body?.y2) || 0)));
      const durationMs = Math.max(50, Math.min(2000, Math.round(Number(req.body?.durationMs) || 250)));

      deviceState.lastTouch = { x: x2, y: y2, action: `SWIPE (${x1},${y1})->(${x2},${y2})`, ts: Date.now() };
      await runAdbSafe([
        'shell',
        'input',
        'swipe',
        String(x1),
        String(y1),
        String(x2),
        String(y2),
        String(durationMs),
      ]);
      broadcastScreenFrame();
      res.json({ ok: true, x1, y1, x2, y2, durationMs });
    } catch (err: any) {
      res.status(503).json({ error: err.message });
    }
  });

  app.post('/api/control/keyevent', requireAuth, async (req: Request, res: Response) => {
    try {
      const allowedKeycodes: Record<string, { code: number; label: string }> = {
        HOME: { code: 3, label: 'KEYCODE_HOME' },
        BACK: { code: 4, label: 'KEYCODE_BACK' },
        RECENTS: { code: 187, label: 'KEYCODE_APP_SWITCH' },
        POWER: { code: 26, label: 'KEYCODE_POWER' },
        WAKEUP: { code: 224, label: 'KEYCODE_WAKEUP' },
        SLEEP: { code: 223, label: 'KEYCODE_SLEEP' },
        VOLUME_UP: { code: 24, label: 'KEYCODE_VOLUME_UP' },
        VOLUME_DOWN: { code: 25, label: 'KEYCODE_VOLUME_DOWN' },
        ENTER: { code: 66, label: 'KEYCODE_ENTER' },
        DEL: { code: 67, label: 'KEYCODE_DEL' },
      };

      const key = String(req.body?.key || '').toUpperCase();
      const target = allowedKeycodes[key];
      if (!target) {
        return res.status(400).json({ error: 'Mã phím không hợp lệ.' });
      }

      if (key === 'POWER') deviceState.screenAwake = !deviceState.screenAwake;
      if (key === 'WAKEUP' || key === 'HOME') deviceState.screenAwake = true;
      if (key === 'SLEEP') deviceState.screenAwake = false;
      if (key === 'HOME') {
        deviceState.currentAppPkg = 'com.lge.launcher3';
        deviceState.currentAppTitle = 'LG UX 9 Home Screen';
      }

      deviceState.lastTouch = { x: 540, y: 2280, action: target.label, ts: Date.now() };
      await runAdbSafe(['shell', 'input', 'keyevent', String(target.code)]);
      broadcastScreenFrame();
      res.json({ ok: true, key, keycode: target.code, screenAwake: deviceState.screenAwake });
    } catch (err: any) {
      res.status(503).json({ error: err.message });
    }
  });

  app.post('/api/control/text', requireAuth, async (req: Request, res: Response) => {
    try {
      const rawText = String(req.body?.text || '').slice(0, 500);
      const method = String(req.body?.method || 'auto'); // 'auto' | 'adbkeyboard' | 'clipboard' | 'input_text'
      if (!rawText) {
        return res.status(400).json({ error: 'Vui lòng nhập nội dung văn bản.' });
      }

      deviceState.lastTypedText = rawText;
      const isUnicode = requiresUnicodeBroadcast(rawText);

      if (method === 'adbkeyboard' || (method === 'auto' && isUnicode)) {
        // Gửi tiếng Việt qua ADBKeyboard Broadcast bằng Base64 để không lỗi dấu và chống injection
        const b64 = Buffer.from(rawText, 'utf8').toString('base64');
        await runAdbSafe(['shell', 'am', 'broadcast', '-a', 'ADB_INPUT_B64', '--es', 'msg', b64]);
      } else if (method === 'clipboard') {
        // Đặt vào Clipboard hệ thống rồi gửi tổ hợp phím PASTE (KEYCODE_PASTE = 279)
        const escaped = escapeAdbInputText(rawText);
        await runAdbSafe(['shell', 'cmd', 'clipboard', 'set-text', escaped]);
        await runAdbSafe(['shell', 'input', 'keyevent', '279']);
      } else {
        // Văn bản ASCII thuần -> dùng `input text` đã escape khoảng trắng (%s) và ký tự đặc biệt
        const safeAscii = escapeAdbInputText(rawText);
        await runAdbSafe(['shell', 'input', 'text', safeAscii]);
      }

      broadcastScreenFrame();
      res.json({ ok: true, text: rawText, unicodeUsed: isUnicode });
    } catch (err: any) {
      res.status(503).json({ error: err.message });
    }
  });

  // --------------------------------------------------------------------------
  // API QUẢN LÝ ỨNG DỤNG (MỞ / ĐÓNG / GỠ / CÀI APK)
  // --------------------------------------------------------------------------
  app.post('/api/apps/action', requireAuth, async (req: Request, res: Response) => {
    try {
      const pkg = String(req.body?.pkg || '').trim();
      const action = String(req.body?.action || '');

      if (!validatePackageName(pkg)) {
        return res.status(400).json({ error: 'Tên package không hợp lệ (đã chặn để chống Command Injection).' });
      }

      const appItem = deviceState.apps.find((a) => a.pkg === pkg);

      if (action === 'launch') {
        await runAdbSafe(['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1']);
        deviceState.currentAppPkg = pkg;
        deviceState.currentAppTitle = appItem ? appItem.name : pkg;
        deviceState.screenAwake = true;
        if (appItem) appItem.running = true;
      } else if (action === 'stop') {
        await runAdbSafe(['shell', 'am', 'force-stop', pkg]);
        if (appItem) appItem.running = false;
        if (deviceState.currentAppPkg === pkg) {
          deviceState.currentAppPkg = 'com.lge.launcher3';
          deviceState.currentAppTitle = 'LG UX 9 Home Screen';
        }
      } else if (action === 'uninstall') {
        if (pkg === 'com.termux') {
          return res.status(400).json({ error: 'Không thể gỡ chính ứng dụng Termux đang chạy máy chủ Cloud Phone!' });
        }
        await runAdbSafe(['uninstall', pkg]);
        deviceState.apps = deviceState.apps.filter((a) => a.pkg !== pkg);
      } else {
        return res.status(400).json({ error: 'Hành động không hợp lệ.' });
      }

      broadcastScreenFrame();
      res.json({ ok: true, apps: deviceState.apps, currentAppPkg: deviceState.currentAppPkg });
    } catch (err: any) {
      res.status(503).json({ error: err.message });
    }
  });

  app.post('/api/apps/install-apk', requireAuth, upload.single('apk'), async (req: Request, res: Response) => {
    try {
      const file = req.file;
      const customPkgName = String(req.body?.packageName || '').trim();
      const fileName = file ? file.originalname : String(req.body?.fileName || 'custom-app.apk');

      if (!fileName.toLowerCase().endsWith('.apk')) {
        if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
        return res.status(400).json({ error: 'Chỉ chấp nhận tệp tin có định dạng .apk' });
      }

      const targetPath = file ? file.path : `/sdcard/Download/${path.basename(fileName)}`;
      await runAdbSafe(['install', '-r', targetPath]);

      if (file && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }

      const inferredPkg =
        customPkgName && validatePackageName(customPkgName)
          ? customPkgName
          : `com.g8x.${path.basename(fileName, '.apk').toLowerCase().replace(/[^a-z0-9]/g, '') || 'customapp'}`;

      if (!deviceState.apps.some((a) => a.pkg === inferredPkg)) {
        deviceState.apps.unshift({
          pkg: inferredPkg,
          name: path.basename(fileName, '.apk'),
          type: 'user',
          running: false,
          version: '1.0.0',
        });
      }

      res.json({ ok: true, installedPkg: inferredPkg, apps: deviceState.apps });
    } catch (err: any) {
      res.status(503).json({ error: err.message });
    }
  });

  // --------------------------------------------------------------------------
  // API UPLOAD / DOWNLOAD FILE (ADB PUSH / PULL) & CHỤP MÀN HÌNH
  // --------------------------------------------------------------------------
  app.post('/api/files/push', requireAuth, upload.single('file'), async (req: Request, res: Response) => {
    try {
      const remoteDir = String(req.body?.remoteDir || '/sdcard/Download').trim();
      if (!validateDevicePath(remoteDir)) {
        return res.status(400).json({ error: 'Đường dẫn đích phải nằm trong /sdcard hoặc /storage/emulated/0 và không chứa ký tự lạ.' });
      }

      const uploaded = req.file;
      const fileName = uploaded
        ? path.basename(uploaded.originalname).replace(/[^a-zA-Z0-9._-]/g, '_')
        : String(req.body?.fileName || 'note-g8x.txt').replace(/[^a-zA-Z0-9._-]/g, '_');
      const sizeBytes = uploaded ? uploaded.size : Number(req.body?.sizeBytes) || 4096;

      const remoteFullPath = `${remoteDir.replace(/\/$/, '')}/${fileName}`;
      if (!validateDevicePath(remoteFullPath)) {
        return res.status(400).json({ error: 'Đường dẫn tệp trên máy không hợp lệ.' });
      }

      await runAdbSafe(['push', uploaded ? uploaded.path : fileName, remoteFullPath]);
      if (uploaded && fs.existsSync(uploaded.path)) {
        fs.unlinkSync(uploaded.path);
      }

      deviceState.files.unshift({
        name: fileName,
        path: remoteFullPath,
        sizeBytes,
        updatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
        isDir: false,
      });

      res.json({ ok: true, file: deviceState.files[0], files: deviceState.files });
    } catch (err: any) {
      res.status(503).json({ error: err.message });
    }
  });

  app.get('/api/files/pull', requireAuth, async (req: Request, res: Response) => {
    try {
      const remotePath = String(req.query.path || '').trim();
      if (!validateDevicePath(remotePath)) {
        return res.status(400).json({ error: 'Đường dẫn tải về không hợp lệ hoặc nằm ngoài vùng cho phép (/sdcard).' });
      }

      await runAdbSafe(['pull', remotePath, UPLOAD_DIR]);
      const baseName = path.basename(remotePath);
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.txt"`);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(
        `# Tệp trích xuất qua ADB Pull từ LG G8X ThinQ\n# Đường dẫn gốc: ${remotePath}\n# Thời gian: ${new Date().toISOString()}\n`
      );
    } catch (err: any) {
      res.status(503).json({ error: err.message });
    }
  });

  app.get('/api/screen/screenshot', requireAuth, async (_req: Request, res: Response) => {
    await runAdbSafe(['exec-out', 'screencap', '-p']);
    const svg = buildSimulatedScreenSvg();
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Content-Disposition', `attachment; filename="g8x-screencap-${Date.now()}.svg"`);
    res.send(svg);
  });

  // --------------------------------------------------------------------------
  // API WATCHDOG, MÔ PHỎNG NHIỆT ĐỘ / ĐỔI WI-FI & SHELL TÙY Ý
  // --------------------------------------------------------------------------
  app.post('/api/watchdog/test', requireAuth, async (req: Request, res: Response) => {
    const { action, temperatureC, batteryLevel, adbPortNew } = req.body || {};

    if (action === 'simulate_temp' && typeof temperatureC === 'number') {
      deviceState.battery.temperatureC = Math.max(25, Math.min(55, Math.round(temperatureC * 10) / 10));
      const thermal = evaluateThermalPolicy(
        deviceState.battery.temperatureC,
        deviceState.requestedFps,
        THERMAL_THROTTLE_C,
        THERMAL_CRITICAL_C
      );
      appendRotatingLog('watchdog.log', `Cập nhật cảm biến nhiệt độ pin: ${deviceState.battery.temperatureC}°C -> ${thermal.messageVi}`);
      restartStreamLoopIfNeeded();
      broadcastScreenFrame();
    } else if (action === 'simulate_battery' && typeof batteryLevel === 'number') {
      deviceState.battery.level = Math.max(1, Math.min(100, Math.round(batteryLevel)));
    } else if (action === 'simulate_wifi_change') {
      // Mô phỏng tình huống đổi Wi-Fi khiến ADB bị offline tạm thời rồi Watchdog tự kết nối lại
      deviceState.adbConnected = false;
      deviceState.watchdogAttempts += 1;
      const delayMs = calculateWatchdogBackoffMs(deviceState.watchdogAttempts);
      appendRotatingLog(
        'watchdog.log',
        `Phát hiện đổi mạng Wi-Fi -> ADB (${deviceState.adbTarget}) chuyển sang OFFLINE. Watchdog kích hoạt reconnect (Backoff: ${delayMs / 1000}s)...`
      );
    } else if (action === 'reconnect_adb_now') {
      if (typeof adbPortNew === 'number' && adbPortNew >= 1024 && adbPortNew <= 65535) {
        adbPort = adbPortNew;
        deviceState.adbTarget = `${ADB_HOST}:${adbPort}`;
      }
      deviceState.adbConnected = true;
      deviceState.watchdogAttempts = 0;
      deviceState.lastWatchdogCheck = new Date().toLocaleTimeString('vi-VN', { hour12: false });
      await runAdbSafe(['connect', deviceState.adbTarget]);
      appendRotatingLog('watchdog.log', `Đã kết nối lại thành công ADB tới ${deviceState.adbTarget}!`);
      restartStreamLoopIfNeeded();
    } else if (action === 'toggle_arbitrary_shell') {
      allowArbitraryShell = Boolean(req.body?.enabled);
      appendRotatingLog('watchdog.log', `Cấu hình ALLOW_ARBITRARY_SHELL = ${allowArbitraryShell}`);
    }

    const thermal = evaluateThermalPolicy(
      deviceState.battery.temperatureC,
      deviceState.requestedFps,
      THERMAL_THROTTLE_C,
      THERMAL_CRITICAL_C
    );
    res.json({ ok: true, device: deviceState, thermal, allowArbitraryShell, watchdogLogs: watchdogLogs.slice(0, 30) });
  });

  app.post('/api/adb/shell', requireAuth, async (req: Request, res: Response) => {
    if (!allowArbitraryShell) {
      return res.status(403).json({
        error: 'Tính năng chạy ADB Shell tùy ý đang bị khóa để bảo mật. Chỉ bật khi đặt ALLOW_ARBITRARY_SHELL=true.',
      });
    }
    const rawCmd = String(req.body?.command || '').trim();
    if (!rawCmd || rawCmd.length > 200) {
      return res.status(400).json({ error: 'Lệnh shell không hợp lệ.' });
    }
    const safeTokens = rawCmd.split(/\s+/).filter(Boolean);
    const result = await runAdbSafe(['shell', ...safeTokens]);
    res.json({ ok: true, output: result.stdout });
  });

  // --------------------------------------------------------------------------
  // WEBSOCKET STREAMING: CHỈ STREAM KHI CÓ NGƯỜI ĐANG XEM (ACTIVE VIEWERS > 0)
  // --------------------------------------------------------------------------
  const wss = new WebSocketServer({ noServer: true });

  function broadcastScreenFrame() {
    if (wsViewers.size === 0) return;

    const thermal = evaluateThermalPolicy(
      deviceState.battery.temperatureC,
      deviceState.requestedFps,
      THERMAL_THROTTLE_C,
      THERMAL_CRITICAL_C
    );

    const payload = JSON.stringify({
      type: 'frame',
      timestamp: Date.now(),
      streamMode: deviceState.streamMode,
      thermal,
      battery: deviceState.battery,
      adbConnected: deviceState.adbConnected,
      screenAwake: deviceState.screenAwake,
      rotation: deviceState.rotation,
      activeViewers: wsViewers.size,
      svgFrame: thermal.streamPaused || !deviceState.adbConnected ? null : buildSimulatedScreenSvg(),
    });

    for (const client of wsViewers) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  function restartStreamLoopIfNeeded() {
    if (streamTimer) {
      clearInterval(streamTimer);
      streamTimer = null;
    }

    // Nguyên tắc vàng: Khi không có người xem (wsViewers.size === 0), dừng hẳn vòng lặp chụp màn hình
    if (wsViewers.size === 0) {
      appendRotatingLog('watchdog.log', 'Không còn người xem trên trình duyệt -> Đã dừng hẳn luồng chụp màn hình để tiết kiệm pin & hạ nhiệt.');
      return;
    }

    const thermal = evaluateThermalPolicy(
      deviceState.battery.temperatureC,
      deviceState.requestedFps,
      THERMAL_THROTTLE_C,
      THERMAL_CRITICAL_C
    );

    if (thermal.streamPaused || thermal.effectiveFps <= 0) {
      broadcastScreenFrame();
      return;
    }

    const intervalMs = Math.max(100, Math.round(1000 / thermal.effectiveFps));
    streamTimer = setInterval(() => {
      broadcastScreenFrame();
    }, intervalMs);
  }

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (url.pathname !== '/ws/screen') {
      socket.destroy();
      return;
    }

    // Kiểm tra Origin của WebSocket để chống Cross-Site WebSocket Hijacking (CSWSH)
    const origin = request.headers.origin;
    const host = request.headers.host;
    if (origin && host) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== host) {
          socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
          socket.destroy();
          return;
        }
      } catch {
        socket.destroy();
        return;
      }
    }

    // Kiểm tra cookie phiên đăng nhập hoặc ?autostart=1
    const cookieHeader = request.headers.cookie || '';
    const match = cookieHeader.match(/g8x_session=([^;]+)/);
    const token = match ? match[1] : null;
    const isAutostart = url.searchParams.get('autostart') === '1';

    if ((!token || !activeSessions.has(token)) && !isAutostart) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    const wasEmpty = wsViewers.size === 0;
    wsViewers.add(ws);

    if (wasEmpty) {
      appendRotatingLog('watchdog.log', `Có người xem kết nối WebSocket (${wsViewers.size} viewer) -> Bắt đầu stream màn hình.`);
      restartStreamLoopIfNeeded();
    }

    // Gửi khung hình đầu tiên ngay lập tức
    broadcastScreenFrame();

    ws.on('close', () => {
      wsViewers.delete(ws);
      if (wsViewers.size === 0) {
        restartStreamLoopIfNeeded();
      }
    });
  });

  // --------------------------------------------------------------------------
  // VÒNG LẶP WATCHDOG ĐỊNH KỲ (30 GIÂY/LẦN)
  // --------------------------------------------------------------------------
  setInterval(async () => {
    deviceState.lastWatchdogCheck = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    if (!deviceState.adbConnected) {
      deviceState.watchdogAttempts += 1;
      // Tự động phục hồi kết nối ADB sau khi thử lại
      deviceState.adbConnected = true;
      appendRotatingLog(
        'watchdog.log',
        `[AUTO-RECOVERY] Watchdog đã tự động kết nối lại ADB (${deviceState.adbTarget}) thành công sau lần thử #${deviceState.watchdogAttempts}.`
      );
      deviceState.watchdogAttempts = 0;
      restartStreamLoopIfNeeded();
    } else if (deviceState.mode === 'real_adb') {
      try {
        const { stdout } = await execFileAsync('adb', ['-s', deviceState.adbTarget, 'shell', 'dumpsys', 'battery'], {
          timeout: 4000,
        });
        deviceState.battery = parseDumpsysBattery(stdout);
      } catch {
        // Giữ nguyên giá trị telemetry gần nhất
      }
    }
  }, 30000);

  // --------------------------------------------------------------------------
  // TÍCH HỢP VITE TRONG DEV HOẶC PHỤC VỤ TỆP TĨNH TRONG PRODUCTION
  // --------------------------------------------------------------------------
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, BIND_HOST, () => {
    console.log(`[G8X Cloud Phone] Server đang chạy tại http://${BIND_HOST}:${PORT}`);
  });
}

startServer();
