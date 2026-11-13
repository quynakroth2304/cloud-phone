import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Sun, Moon, LogOut } from 'lucide-react';
import { LoginView } from './components/LoginView';
import { PhoneViewport } from './components/PhoneViewport';
import { ToolsPanel, ActiveToolTab } from './components/ToolsPanel';
import { ScreenRotation, BatteryTelemetry, ThermalPolicyDecision } from './utils/cloudPhoneLogic';

export default function App() {
  const [darkMode, setDarkMode] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  const [activeTab, setActiveTab] = useState<ActiveToolTab>('apps');
  const [viewerPaused, setViewerPaused] = useState(false);
  const [streamConnected, setStreamConnected] = useState(false);
  const [svgFrame, setSvgFrame] = useState<string | null>(null);

  const [device, setDevice] = useState<{
    mode: string;
    adbConnected: boolean;
    adbTarget: string;
    wifiSsid: string;
    wifiIp: string;
    wifiRssiDbm: number;
    screenAwake: boolean;
    rotation: ScreenRotation;
    physicalWidth: number;
    physicalHeight: number;
    requestedFps: number;
    jpegQuality: number;
    resolutionScale: number;
    streamMode: 'mvp_jpeg' | 'scrcpy_h264';
    battery: BatteryTelemetry;
    apps: Array<{ pkg: string; name: string; type: 'user' | 'system'; running: boolean; version: string }>;
    files: Array<{ name: string; path: string; sizeBytes: number; updatedAt: string; isDir: boolean }>;
  }>({
    mode: 'simulated_g8x',
    adbConnected: true,
    adbTarget: '127.0.0.1:5555',
    wifiSsid: 'G8X_Home_5GHz',
    wifiIp: '192.168.1.88',
    wifiRssiDbm: -48,
    screenAwake: true,
    rotation: 0,
    physicalWidth: 1080,
    physicalHeight: 2340,
    requestedFps: 5,
    jpegQuality: 75,
    resolutionScale: 0.75,
    streamMode: 'mvp_jpeg',
    battery: {
      level: 84,
      temperatureC: 35.8,
      voltageMv: 4185,
      status: 'Charging',
      plugged: 'AC',
      health: 'Good',
    },
    apps: [],
    files: [],
  });

  const [thermal, setThermal] = useState<ThermalPolicyDecision>({
    state: 'normal',
    effectiveFps: 5,
    streamPaused: false,
    messageVi: 'Nhiệt độ ổn định (35.8°C). Đang hoạt động ở 5 FPS.',
  });

  const [allowArbitraryShell, setAllowArbitraryShell] = useState(false);
  const [adbHistory, setAdbHistory] = useState<any[]>([]);
  const [watchdogLogs, setWatchdogLogs] = useState<string[]>([]);
  const [logcat, setLogcat] = useState<string[]>([]);

  const wsRef = useRef<WebSocket | null>(null);

  // Đồng bộ class .dark trên <html>
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const fetchFullState = useCallback(async () => {
    try {
      const res = await fetch('/api/state');
      if (res.status === 401) {
        setAuthenticated(false);
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      setDevice(data.device);
      setThermal(data.thermal);
      setAllowArbitraryShell(Boolean(data.allowArbitraryShell));
      setAdbHistory(data.adbHistory || []);
      setWatchdogLogs(data.watchdogLogs || []);
      setLogcat(data.logcat || []);
    } catch {
      // Bỏ qua lỗi mạng tạm thời
    }
  }, []);

  // Kiểm tra trạng thái đăng nhập (hỗ trợ ?autostart=1)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const query = params.get('autostart') === '1' ? '?autostart=1' : '';
    fetch(`/api/auth/status${query}`)
      .then((r) => r.json())
      .then((data) => {
        setAuthenticated(Boolean(data.authenticated));
        setAuthChecked(true);
      })
      .catch(() => {
        setAuthChecked(true);
      });
  }, []);

  // Khi đã đăng nhập, lấy trạng thái ban đầu và kết nối WebSocket nếu người dùng đang xem
  useEffect(() => {
    if (!authenticated) return;
    fetchFullState();
    const pollTimer = setInterval(fetchFullState, 4000);
    return () => clearInterval(pollTimer);
  }, [authenticated, fetchFullState]);

  useEffect(() => {
    if (!authenticated || viewerPaused) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setStreamConnected(false);
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const params = new URLSearchParams(window.location.search);
    const query = params.get('autostart') === '1' ? '?autostart=1' : '';
    const wsUrl = `${proto}//${window.location.host}/ws/screen${query}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setStreamConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'frame') {
          if (msg.svgFrame !== undefined) setSvgFrame(msg.svgFrame);
          if (msg.thermal) setThermal(msg.thermal);
          if (msg.battery) {
            setDevice((prev) => ({
              ...prev,
              battery: msg.battery,
              adbConnected: msg.adbConnected,
              screenAwake: msg.screenAwake,
              rotation: msg.rotation,
            }));
          }
        }
      } catch {
        // Ignore malformed frame
      }
    };

    ws.onclose = () => {
      setStreamConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [authenticated, viewerPaused]);

  const handleUpdateStreamConfig = async (patch: Record<string, any>) => {
    const res = await fetch('/api/stream/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const data = await res.json();
      setDevice(data.device);
      setThermal(data.thermal);
    }
  };

  const handleTap = async (x: number, y: number) => {
    await fetch('/api/control/tap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, y }),
    });
    fetchFullState();
  };

  const handleSwipe = async (x1: number, y1: number, x2: number, y2: number, durationMs: number) => {
    await fetch('/api/control/swipe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x1, y1, x2, y2, durationMs }),
    });
    fetchFullState();
  };

  const handleKeyEvent = async (key: string) => {
    await fetch('/api/control/keyevent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    fetchFullState();
  };

  const handleSendText = async (text: string, method: string) => {
    await fetch('/api/control/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, method }),
    });
    fetchFullState();
  };

  const handleAppAction = async (pkg: string, action: 'launch' | 'stop' | 'uninstall') => {
    await fetch('/api/apps/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pkg, action }),
    });
    fetchFullState();
  };

  const handleInstallApk = async (fileName: string, packageName: string) => {
    await fetch('/api/apps/install-apk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName, packageName }),
    });
    fetchFullState();
  };

  const handlePushFile = async (remoteDir: string, fileName: string, sizeBytes: number) => {
    await fetch('/api/files/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remoteDir, fileName, sizeBytes }),
    });
    fetchFullState();
  };

  const handleWatchdogTest = async (payload: Record<string, any>) => {
    const res = await fetch('/api/watchdog/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      fetchFullState();
    }
  };

  const handleRunArbitraryShell = async (command: string): Promise<string> => {
    const res = await fetch('/api/adb/shell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });
    const data = await res.json();
    fetchFullState();
    return data.output || data.error || '';
  };

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setAuthenticated(false);
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center text-sm font-mono">
        Đang khởi tạo kết nối G8X Cloud Phone...
      </div>
    );
  }

  if (!authenticated) {
    return (
      <LoginView
        onLoginSuccess={() => setAuthenticated(true)}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode(!darkMode)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col transition-colors">
      {/* Top Bar theo đúng chuẩn 3-zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        {/* Zone 1: Brand Title */}
        <a href="/" className="text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0">
          G8X Cloud Phone
        </a>

        {/* Zone 2: 4-5 Concise Nav Links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400">
          <button
            type="button"
            onClick={() => setActiveTab('apps')}
            className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Ứng dụng
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('files')}
            className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Truyền File
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('logcat')}
            className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Logcat
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('watchdog')}
            className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Watchdog 24/7
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('scripts')}
            className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Script Termux
          </button>
        </nav>

        {/* Zone 3: Primary Action */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setDarkMode(!darkMode)}
            aria-label={darkMode ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
            className="p-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="px-3.5 py-2 text-xs font-medium text-white bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Đăng xuất</span>
          </button>
        </div>
      </header>

      {/* Dải thông tin trạng thái thiết bị dạng văn bản sạch (Zero-Pill Discipline) */}
      <div className="px-6 py-2.5 bg-slate-100/70 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600 dark:text-slate-400 font-mono tabular-nums">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-900 dark:text-slate-200">LG G8X ThinQ (LM-G850)</span>
          <span aria-hidden="true">·</span>
          <span>ADB: {device.adbTarget} ({device.adbConnected ? 'ONLINE' : 'OFFLINE'})</span>
          <span aria-hidden="true">·</span>
          <span>Wi-Fi: {device.wifiSsid} ({device.wifiIp})</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span>Pin: {device.battery.level}% ({device.battery.plugged})</span>
          <span aria-hidden="true">·</span>
          <span>Nhiệt độ: {device.battery.temperatureC.toFixed(1)}°C</span>
          <span aria-hidden="true">·</span>
          <span>Stream: {viewerPaused ? 'TẠM DỪNG (0% CPU)' : `${thermal.effectiveFps} FPS`}</span>
        </div>
      </div>

      {/* Bố cục chính: Khung điện thoại bên trái/giữa + Bảng công cụ bên phải */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-5 xl:col-span-5 w-full">
          <PhoneViewport
            svgFrame={svgFrame}
            streamConnected={streamConnected}
            viewerPaused={viewerPaused}
            onToggleViewerPause={() => setViewerPaused(!viewerPaused)}
            adbConnected={device.adbConnected}
            screenAwake={device.screenAwake}
            rotation={device.rotation}
            physicalWidth={device.physicalWidth}
            physicalHeight={device.physicalHeight}
            requestedFps={device.requestedFps}
            jpegQuality={device.jpegQuality}
            resolutionScale={device.resolutionScale}
            streamMode={device.streamMode}
            battery={device.battery}
            thermal={thermal}
            onUpdateStreamConfig={handleUpdateStreamConfig}
            onTap={handleTap}
            onSwipe={handleSwipe}
            onKeyEvent={handleKeyEvent}
            onSendText={handleSendText}
            onReconnectAdb={() => handleWatchdogTest({ action: 'reconnect_adb_now' })}
          />
        </div>

        <div className="lg:col-span-7 xl:col-span-7 w-full">
          <ToolsPanel
            activeTab={activeTab}
            onSelectTab={setActiveTab}
            apps={device.apps}
            files={device.files}
            adbHistory={adbHistory}
            watchdogLogs={watchdogLogs}
            logcat={logcat}
            battery={device.battery}
            thermal={thermal}
            adbConnected={device.adbConnected}
            adbTarget={device.adbTarget}
            wifiSsid={device.wifiSsid}
            wifiIp={device.wifiIp}
            wifiRssiDbm={device.wifiRssiDbm}
            allowArbitraryShell={allowArbitraryShell}
            onAppAction={handleAppAction}
            onInstallApk={handleInstallApk}
            onPushFile={handlePushFile}
            onWatchdogTest={handleWatchdogTest}
            onRunArbitraryShell={handleRunArbitraryShell}
          />
        </div>
      </main>
    </div>
  );
}
