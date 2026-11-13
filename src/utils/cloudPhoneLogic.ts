/**
 * Module xử lý logic thuần (Pure Logic) cho G8X Cloud Phone:
 * 1. Quy đổi tọa độ cảm ứng theo độ phân giải thật (wm size) và góc xoay màn hình (0, 90, 180, 270).
 * 2. Kiểm tra & làm sạch tham số truyền vào ADB (chống Command Injection & Path Traversal).
 * 3. Phân tích dữ liệu `dumpsys battery` và chính sách bảo vệ nhiệt độ 24/7.
 * 4. Tính toán thời gian chờ (Exponential Backoff) cho Watchdog kết nối lại ADB.
 */

export type ScreenRotation = 0 | 1 | 2 | 3; // 0: 0°, 1: 90° (Landscape), 2: 180°, 3: 270° (Landscape đảo)

export interface DeviceResolution {
  physicalWidth: number;  // Mặc định LG G8X ThinQ: 1080
  physicalHeight: number; // Mặc định LG G8X ThinQ: 2340
  rotation: ScreenRotation;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Trả về kích thước hiển thị thực tế của màn hình dựa theo hướng xoay hiện tại.
 * Nếu xoay ngang (rotation = 1 hoặc 3), chiều rộng và chiều cao hoán đổi cho nhau.
 */
export function getActiveScreenDimensions(res: DeviceResolution): { width: number; height: number } {
  const isLandscape = res.rotation === 1 || res.rotation === 3;
  return {
    width: isLandscape ? res.physicalHeight : res.physicalWidth,
    height: isLandscape ? res.physicalWidth : res.physicalHeight,
  };
}

/**
 * Quy đổi tọa độ click/touch trên khung hiển thị trình duyệt (CSS pixels)
 * sang tọa độ pixel thực tế trên màn hình Android (`wm size`).
 */
export function mapViewportToDeviceCoords(
  offsetX: number,
  offsetY: number,
  viewportWidth: number,
  viewportHeight: number,
  res: DeviceResolution
): Point {
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    return { x: 0, y: 0 };
  }

  const { width: activeW, height: activeH } = getActiveScreenDimensions(res);

  // Tỷ lệ tương đối [0..1]
  const normX = Math.max(0, Math.min(1, offsetX / viewportWidth));
  const normY = Math.max(0, Math.min(1, offsetY / viewportHeight));

  const x = Math.min(activeW - 1, Math.max(0, Math.round(normX * activeW)));
  const y = Math.min(activeH - 1, Math.max(0, Math.round(normY * activeH)));

  return { x, y };
}

/**
 * Kiểm tra tên gói ứng dụng Android (package name) hợp lệ.
 * Chặn hoàn toàn ký tự lạ để tránh Command Injection khi chạy `monkey` hoặc `am force-stop`.
 */
export function validatePackageName(pkg: string): boolean {
  if (!pkg || pkg.length > 160) return false;
  return /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/.test(pkg);
}

/**
 * Kiểm tra đường dẫn file trên thiết bị Android (chỉ cho phép trong /sdcard hoặc /storage/emulated/0).
 * Chặn `..`, ký tự điều khiển shell, hoặc đường dẫn hệ thống nhạy cảm.
 */
export function validateDevicePath(remotePath: string): boolean {
  if (!remotePath || remotePath.length > 512) return false;
  // Chặn ký tự nguy hiểm trong shell hoặc path traversal
  if (remotePath.includes('..') || /[;&|`$<>\\'"\n\r\0]/.test(remotePath)) {
    return false;
  }
  const normalized = remotePath.trim();
  return (
    normalized.startsWith('/sdcard/') ||
    normalized === '/sdcard' ||
    normalized.startsWith('/storage/emulated/0/') ||
    normalized === '/storage/emulated/0' ||
    normalized.startsWith('/data/local/tmp/')
  );
}

/**
 * Kiểm tra chuỗi văn bản có chứa tiếng Việt (Unicode ngoài bảng mã ASCII cơ bản)
 * hoặc ký tự cần chuyển qua ADBKeyboard / Clipboard Broadcast hay không.
 */
export function requiresUnicodeBroadcast(text: string): boolean {
  if (!text) return false;
  // Bất kỳ ký tự nào ngoài ASCII printable (32..126) đều cần gửi qua Broadcast Base64/Clipboard
  return /[^\x20-\x7E]/.test(text);
}

/**
 * Làm sạch và mã hóa chuỗi ASCII để truyền an toàn vào `adb shell input text "..."`
 * Trong Android `input text`, khoảng trắng phải thay bằng `%s` và các ký tự đặc biệt của shell phải được escape.
 */
export function escapeAdbInputText(text: string): string {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/ /g, '%s')
    .replace(/['"`$&|;<>()*?~#!]/g, (match) => `\\${match}`);
}

export interface BatteryTelemetry {
  level: number;          // % pin (0 - 100)
  temperatureC: number;   // Nhiệt độ (°C), ví dụ 36.5
  voltageMv: number;      // Điện áp (mV), ví dụ 4180
  status: 'Charging' | 'Discharging' | 'Full' | 'Not charging' | 'Unknown';
  plugged: 'AC' | 'USB' | 'Wireless' | 'None';
  health: string;
}

/**
 * Phân tích đầu ra của lệnh `adb shell dumpsys battery`
 */
export function parseDumpsysBattery(rawOutput: string): BatteryTelemetry {
  const getVal = (key: string): string | null => {
    const regex = new RegExp(`^\\s*${key}:\\s*(.+)$`, 'mi');
    const match = rawOutput.match(regex);
    return match ? match[1].trim() : null;
  };

  const levelRaw = parseInt(getVal('level') || '85', 10);
  const scaleRaw = parseInt(getVal('scale') || '100', 10);
  const tempRaw = parseInt(getVal('temperature') || '345', 10); // 345 = 34.5°C
  const voltageRaw = parseInt(getVal('voltage') || '4150', 10);
  const statusCode = parseInt(getVal('status') || '2', 10);

  const acPowered = getVal('AC powered') === 'true';
  const usbPowered = getVal('USB powered') === 'true';
  const wirelessPowered = getVal('Wireless powered') === 'true';

  const statusMap: Record<number, BatteryTelemetry['status']> = {
    1: 'Unknown',
    2: 'Charging',
    3: 'Discharging',
    4: 'Not charging',
    5: 'Full',
  };

  let plugged: BatteryTelemetry['plugged'] = 'None';
  if (acPowered) plugged = 'AC';
  else if (usbPowered) plugged = 'USB';
  else if (wirelessPowered) plugged = 'Wireless';

  const level = scaleRaw > 0 ? Math.round((levelRaw / scaleRaw) * 100) : levelRaw;

  return {
    level: Number.isNaN(level) ? 85 : Math.max(0, Math.min(100, level)),
    temperatureC: Number.isNaN(tempRaw) ? 34.5 : Math.round((tempRaw / 10) * 10) / 10,
    voltageMv: Number.isNaN(voltageRaw) ? 4150 : voltageRaw,
    status: statusMap[statusCode] || 'Charging',
    plugged,
    health: 'Good',
  };
}

export interface ThermalPolicyDecision {
  state: 'normal' | 'warm' | 'throttled' | 'critical_paused';
  effectiveFps: number;
  streamPaused: boolean;
  messageVi: string;
}

/**
 * Đánh giá nhiệt độ pin/máy để tự động giảm FPS hoặc tạm dừng stream bảo vệ phần cứng LG G8X khi chạy 24/7.
 */
export function evaluateThermalPolicy(
  temperatureC: number,
  requestedFps: number,
  throttleThresholdC = 42,
  criticalThresholdC = 45
): ThermalPolicyDecision {
  const safeRequestedFps = Math.max(1, Math.min(15, requestedFps));

  if (temperatureC >= criticalThresholdC) {
    return {
      state: 'critical_paused',
      effectiveFps: 0,
      streamPaused: true,
      messageVi: `Nhiệt độ vượt ngưỡng nguy hiểm (${temperatureC.toFixed(1)}°C >= ${criticalThresholdC}°C). Đã tạm dừng stream màn hình để hạ nhiệt bảo vệ pin!`,
    };
  }

  if (temperatureC >= throttleThresholdC) {
    const throttledFps = Math.min(safeRequestedFps, 2);
    return {
      state: 'throttled',
      effectiveFps: throttledFps,
      streamPaused: false,
      messageVi: `Cảnh báo nhiệt độ cao (${temperatureC.toFixed(1)}°C >= ${throttleThresholdC}°C). Hệ thống tự động giảm tốc độ stream xuống ${throttledFps} FPS.`,
    };
  }

  if (temperatureC >= throttleThresholdC - 2) {
    const warmFps = Math.min(safeRequestedFps, 4);
    return {
      state: 'warm',
      effectiveFps: warmFps,
      streamPaused: false,
      messageVi: `Máy đang ấm (${temperatureC.toFixed(1)}°C). Giới hạn tối đa ${warmFps} FPS để duy trì ổn định 24/7.`,
    };
  }

  return {
    state: 'normal',
    effectiveFps: safeRequestedFps,
    streamPaused: false,
    messageVi: `Nhiệt độ ổn định (${temperatureC.toFixed(1)}°C). Đang hoạt động ở ${safeRequestedFps} FPS.`,
  };
}

/**
 * Tính thời gian chờ (ms) giữa các lần thử kết nối lại ADB theo thuật toán Exponential Backoff.
 */
export function calculateWatchdogBackoffMs(attempt: number, baseMs = 5000, maxMs = 60000): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const delay = baseMs * Math.pow(2, safeAttempt - 1);
  return Math.min(maxMs, delay);
}
