import React, { useState } from 'react';
import {
  Package,
  FolderUp,
  Terminal,
  ShieldAlert,
  FileCode2,
  Play,
  Square,
  Trash2,
  Upload,
  Download,
  Copy,
  Check,
  RefreshCw,
  Wifi,
  BatteryCharging,
  Thermometer,
} from 'lucide-react';
import { TERMUX_SCRIPTS_DOCS } from '../data/termuxScripts';
import { BatteryTelemetry, ThermalPolicyDecision } from '../utils/cloudPhoneLogic';

export type ActiveToolTab = 'apps' | 'files' | 'logcat' | 'watchdog' | 'scripts';

interface ToolsPanelProps {
  activeTab: ActiveToolTab;
  onSelectTab: (tab: ActiveToolTab) => void;
  apps: Array<{ pkg: string; name: string; type: 'user' | 'system'; running: boolean; version: string }>;
  files: Array<{ name: string; path: string; sizeBytes: number; updatedAt: string; isDir: boolean }>;
  adbHistory: Array<{
    id: string;
    timestamp: string;
    command: string;
    status: string;
    durationMs: number;
    outputPreview: string;
  }>;
  watchdogLogs: string[];
  logcat: string[];
  battery: BatteryTelemetry;
  thermal: ThermalPolicyDecision;
  adbConnected: boolean;
  adbTarget: string;
  wifiSsid: string;
  wifiIp: string;
  wifiRssiDbm: number;
  allowArbitraryShell: boolean;
  onAppAction: (pkg: string, action: 'launch' | 'stop' | 'uninstall') => Promise<void>;
  onInstallApk: (fileName: string, packageName: string) => Promise<void>;
  onPushFile: (remoteDir: string, fileName: string, sizeBytes: number) => Promise<void>;
  onWatchdogTest: (payload: Record<string, any>) => Promise<void>;
  onRunArbitraryShell: (cmd: string) => Promise<string>;
}

export function ToolsPanel({
  activeTab,
  onSelectTab,
  apps,
  files,
  adbHistory,
  watchdogLogs,
  logcat,
  battery,
  thermal,
  adbConnected,
  adbTarget,
  wifiSsid,
  wifiIp,
  wifiRssiDbm,
  allowArbitraryShell,
  onAppAction,
  onInstallApk,
  onPushFile,
  onWatchdogTest,
  onRunArbitraryShell,
}: ToolsPanelProps) {
  // State cho Tab Ứng dụng & APK
  const [appFilter, setAppFilter] = useState<'all' | 'user' | 'system'>('all');
  const [appSearch, setAppSearch] = useState('');
  const [apkFileName, setApkFileName] = useState('zalo-lite-g8x.apk');
  const [apkPkgName, setApkPkgName] = useState('com.zing.zalolite');
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // State cho Tab Truyền File
  const [remoteDir, setRemoteDir] = useState('/sdcard/Download');
  const [uploadFileName, setUploadFileName] = useState('config-24-7.json');

  // State cho Tab Logcat & ADB Shell
  const [logFilter, setLogFilter] = useState('');
  const [shellInput, setShellInput] = useState('dumpsys battery');
  const [shellOutput, setShellOutput] = useState<string | null>(null);

  // State cho Tab Script Termux
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setActionMessage(msg);
    setTimeout(() => setActionMessage(null), 4000);
  };

  const filteredApps = apps.filter((item) => {
    if (appFilter !== 'all' && item.type !== appFilter) return false;
    if (appSearch.trim()) {
      const q = appSearch.toLowerCase();
      return item.name.toLowerCase().includes(q) || item.pkg.toLowerCase().includes(q);
    }
    return true;
  });

  const filteredLogcat = logcat.filter((line) =>
    logFilter.trim() ? line.toLowerCase().includes(logFilter.toLowerCase()) : true
  );

  const handleCopyScript = (id: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleInstallApkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apkFileName.trim()) return;
    await onInstallApk(apkFileName.trim(), apkPkgName.trim());
    showToast(`Đã cài đặt APK ${apkFileName} qua adb install -r thành công.`);
  };

  const handlePushFileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFileName.trim() || !remoteDir.trim()) return;
    await onPushFile(remoteDir.trim(), uploadFileName.trim(), 16384);
    showToast(`Đã đẩy tệp ${uploadFileName} vào ${remoteDir} qua adb push.`);
  };

  const handleShellSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shellInput.trim()) return;
    const out = await onRunArbitraryShell(shellInput.trim());
    setShellOutput(out);
  };

  return (
    <section
      aria-label="Bảng công cụ quản trị thiết bị"
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 flex flex-col gap-4"
    >
      {/* Thanh chuyển Tab Công cụ (1 hàng duy nhất, không rớt dòng trên Desktop) */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
        <button
          type="button"
          onClick={() => onSelectTab('apps')}
          className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 ${
            activeTab === 'apps'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Package className="w-3.5 h-3.5 shrink-0" />
          <span>Ứng dụng ({apps.length})</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('files')}
          className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 ${
            activeTab === 'files'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <FolderUp className="w-3.5 h-3.5 shrink-0" />
          <span>Truyền File ({files.length})</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('logcat')}
          className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 ${
            activeTab === 'logcat'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Terminal className="w-3.5 h-3.5 shrink-0" />
          <span>Logcat & ADB</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('watchdog')}
          className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 ${
            activeTab === 'watchdog'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
          <span>Watchdog 24/7</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectTab('scripts')}
          className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 ${
            activeTab === 'scripts'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <FileCode2 className="w-3.5 h-3.5 shrink-0" />
          <span>Script Termux</span>
        </button>
      </div>

      {actionMessage && (
        <div
          role="status"
          className="px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-800 dark:text-emerald-300"
        >
          {actionMessage}
        </div>
      )}

      {/* =====================================================================
          TAB 1: QUẢN LÝ ỨNG DỤNG (MỞ / ĐÓNG / GỠ / CÀI ĐẶT APK)
         ===================================================================== */}
      {activeTab === 'apps' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => setAppFilter('all')}
                className={`px-2.5 py-1 text-xs font-medium rounded ${
                  appFilter === 'all'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Tất cả ({apps.length})
              </button>
              <button
                type="button"
                onClick={() => setAppFilter('user')}
                className={`px-2.5 py-1 text-xs font-medium rounded ${
                  appFilter === 'user'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Đã cài ({apps.filter((a) => a.type === 'user').length})
              </button>
              <button
                type="button"
                onClick={() => setAppFilter('system')}
                className={`px-2.5 py-1 text-xs font-medium rounded ${
                  appFilter === 'system'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Hệ thống ({apps.filter((a) => a.type === 'system').length})
              </button>
            </div>

            <input
              type="search"
              aria-label="Tìm kiếm ứng dụng theo tên hoặc package"
              value={appSearch}
              onChange={(e) => setAppSearch(e.target.value)}
              placeholder="Tìm tên app hoặc package..."
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white"
            />
          </div>

          {/* Danh sách Package */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800 max-h-[310px] overflow-y-auto">
            {filteredApps.map((app) => (
              <div
                key={app.pkg}
                className="px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">{app.name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">
                    {app.pkg} · v{app.version} · {app.running ? 'Đang chạy' : 'Đã dừng'}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={async () => {
                      await onAppAction(app.pkg, 'launch');
                      showToast(`Đã mở ứng dụng ${app.name} (${app.pkg})`);
                    }}
                    aria-label={`Mở ${app.name}`}
                    className="px-2.5 py-1 text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white rounded flex items-center gap-1 whitespace-nowrap"
                  >
                    <Play className="w-3 h-3" />
                    <span>Mở</span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await onAppAction(app.pkg, 'stop');
                      showToast(`Đã buộc dừng ${app.pkg} (am force-stop)`);
                    }}
                    aria-label={`Đóng ${app.name}`}
                    className="px-2.5 py-1 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded flex items-center gap-1 whitespace-nowrap"
                  >
                    <Square className="w-3 h-3" />
                    <span>Đóng</span>
                  </button>
                  {app.type === 'user' && app.pkg !== 'com.termux' && (
                    <button
                      type="button"
                      onClick={async () => {
                        await onAppAction(app.pkg, 'uninstall');
                        showToast(`Đã gỡ cài đặt ${app.pkg}`);
                      }}
                      aria-label={`Gỡ ${app.name}`}
                      className="p-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 rounded"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Khu vực Upload & Cài đặt file APK */}
          <form
            onSubmit={handleInstallApkSubmit}
            className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3"
          >
            <div className="text-xs font-semibold text-slate-900 dark:text-white">
              Cài đặt gói APK từ xa (<code className="font-mono">adb install -r</code>)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                aria-label="Tên tệp APK cần cài"
                value={apkFileName}
                onChange={(e) => setApkFileName(e.target.value)}
                placeholder="Tên file .apk (ví dụ: app.apk)"
                className="px-3 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono"
              />
              <input
                type="text"
                aria-label="Tên Package tương ứng"
                value={apkPkgName}
                onChange={(e) => setApkPkgName(e.target.value)}
                placeholder="Package ID (ví dụ: com.example.app)"
                className="px-3 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono"
              />
            </div>
            <button
              type="submit"
              className="px-3.5 py-2 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg flex items-center gap-1.5 whitespace-nowrap"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload & Cài đặt APK</span>
            </button>
          </form>
        </div>
      )}

      {/* =====================================================================
          TAB 2: TRUYỀN FILE (ADB PUSH / ADB PULL)
         ===================================================================== */}
      {activeTab === 'files' && (
        <div className="space-y-4">
          <form
            onSubmit={handlePushFileSubmit}
            className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3"
          >
            <div className="text-xs font-semibold text-slate-900 dark:text-white">
              Đẩy tệp lên LG G8X ThinQ (<code className="font-mono">adb push</code> — Chỉ cho phép trong{' '}
              <code className="font-mono">/sdcard</code>)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                aria-label="Thư mục đích trên điện thoại"
                value={remoteDir}
                onChange={(e) => setRemoteDir(e.target.value)}
                placeholder="/sdcard/Download"
                className="px-3 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono"
              />
              <input
                type="text"
                aria-label="Tên tệp đẩy lên"
                value={uploadFileName}
                onChange={(e) => setUploadFileName(e.target.value)}
                placeholder="Tên file (ví dụ: script.sh)"
                className="px-3 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono"
              />
            </div>
            <button
              type="submit"
              className="px-3.5 py-2 text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white rounded-lg flex items-center gap-1.5 whitespace-nowrap"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Đẩy File vào /sdcard (ADB Push)</span>
            </button>
          </form>

          <div className="border border-slate-200 dark:border-slate-800 rounded-lg divide-y divide-slate-200 dark:divide-slate-800">
            {files.map((f) => (
              <div key={f.path} className="px-3.5 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">{f.name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums truncate">
                    {f.path} · {(f.sizeBytes / 1024).toFixed(1)} KB · {f.updatedAt}
                  </div>
                </div>
                <a
                  href={`/api/files/pull?path=${encodeURIComponent(f.path)}`}
                  download
                  className="px-2.5 py-1 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded flex items-center gap-1 whitespace-nowrap shrink-0"
                >
                  <Download className="w-3 h-3" />
                  <span>ADB Pull</span>
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 3: LOGCAT REALTIME & LỊCH SỬ LỆNH ADB
         ===================================================================== */}
      {activeTab === 'logcat' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-900 dark:text-white">
                Nhật ký lệnh ADB thực thi (<code className="font-mono">execFile</code> chống Injection)
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                {adbHistory.length} lệnh gần nhất
              </span>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-lg max-h-[170px] overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800 font-mono text-xs">
              {adbHistory.map((item) => (
                <div key={item.id} className="px-3 py-2 flex items-center justify-between gap-2">
                  <div className="truncate text-slate-800 dark:text-slate-200">
                    <span className="text-slate-400 mr-2">[{item.timestamp}]</span>
                    <span>{item.command}</span>
                  </div>
                  <span className="text-emerald-600 dark:text-emerald-400 shrink-0 tabular-nums">
                    {item.durationMs}ms
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-900 dark:text-white">
                Luồng <code className="font-mono">adb logcat</code> thời gian thực
              </span>
              <input
                type="search"
                aria-label="Lọc nội dung logcat"
                value={logFilter}
                onChange={(e) => setLogFilter(e.target.value)}
                placeholder="Lọc theo tag (ví dụ: Battery, AdbShell)..."
                className="px-2.5 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white font-mono"
              />
            </div>

            <pre className="p-3 rounded-lg bg-slate-950 text-slate-200 text-xs font-mono overflow-x-auto max-h-[180px] overflow-y-auto leading-relaxed">
              {filteredLogcat.join('\n')}
            </pre>
          </div>

          {/* Tùy chọn ADB Shell tùy ý (mặc định tắt theo chuẩn bảo mật) */}
          <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-900 dark:text-white">
                ADB Shell tùy ý (<code className="font-mono">ALLOW_ARBITRARY_SHELL</code>)
              </span>
              <button
                type="button"
                onClick={() => onWatchdogTest({ action: 'toggle_arbitrary_shell', enabled: !allowArbitraryShell })}
                className={`px-2.5 py-1 text-xs font-medium rounded ${
                  allowArbitraryShell
                    ? 'bg-amber-600 text-white'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                {allowArbitraryShell ? 'Đang BẬT (Cho phép chạy)' : 'Đang KHÓA (An toàn)'}
              </button>
            </div>

            <form onSubmit={handleShellSubmit} className="flex gap-2">
              <input
                type="text"
                aria-label="Nhập lệnh ADB shell"
                disabled={!allowArbitraryShell}
                value={shellInput}
                onChange={(e) => setShellInput(e.target.value)}
                className="flex-1 px-3 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!allowArbitraryShell}
                className="px-3 py-1.5 text-xs font-semibold bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded whitespace-nowrap"
              >
                Thực thi
              </button>
            </form>
            {shellOutput && (
              <pre className="p-2.5 rounded bg-slate-900 text-emerald-300 text-xs font-mono overflow-x-auto">
                {shellOutput}
              </pre>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 4: WATCHDOG 24/7, CẢNH BÁO PIN / NHIỆT ĐỘ & CHỐNG ĐỔI WI-FI
         ===================================================================== */}
      {activeTab === 'watchdog' && (
        <div className="space-y-4">
          {/* Bảng thông số Dumpsys Battery & Wi-Fi */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Pin & Điện áp</span>
                <BatteryCharging className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {battery.level}% · {battery.voltageMv} mV
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Nguồn: {battery.plugged} ({battery.status})
              </div>
            </div>

            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Nhiệt độ Pin/SoC</span>
                <Thermometer className="w-4 h-4 text-amber-500" />
              </div>
              <div className="mt-1 text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {battery.temperatureC.toFixed(1)}°C
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                FPS thực tế: {thermal.effectiveFps} FPS ({thermal.state})
              </div>
            </div>

            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Mạng Wi-Fi & ADB</span>
                <Wifi className="w-4 h-4 text-sky-500" />
              </div>
              <div className="mt-1 text-sm font-bold font-mono tabular-nums text-slate-900 dark:text-white truncate">
                {wifiSsid} ({wifiRssiDbm} dBm)
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                ADB: {adbTarget} ({adbConnected ? 'ONLINE' : 'OFFLINE'})
              </div>
            </div>
          </div>

          {/* Bộ mô phỏng kiểm thử sự cố 24/7 */}
          <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-3">
            <div className="text-xs font-semibold text-slate-900 dark:text-white">
              Kiểm thử Cơ chế Tự bảo vệ Nhiệt độ & Tự phục hồi ADB Watchdog
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onWatchdogTest({ action: 'simulate_temp', temperatureC: 35.8 })}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                Nhiệt độ mát (35.8°C)
              </button>
              <button
                type="button"
                onClick={() => onWatchdogTest({ action: 'simulate_temp', temperatureC: 42.8 })}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
              >
                Mô phỏng Nóng 42.8°C (Hạ còn 2 FPS)
              </button>
              <button
                type="button"
                onClick={() => onWatchdogTest({ action: 'simulate_temp', temperatureC: 45.6 })}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 hover:bg-red-500 text-white"
              >
                Mô phỏng Quá nhiệt 45.6°C (Dừng Stream)
              </button>
              <button
                type="button"
                onClick={() => onWatchdogTest({ action: 'simulate_wifi_change' })}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200"
              >
                Mô phỏng Đổi Wi-Fi (Rớt ADB)
              </button>
              <button
                type="button"
                onClick={() => onWatchdogTest({ action: 'reconnect_adb_now' })}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-sky-600 hover:bg-sky-500 text-white flex items-center gap-1"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Chạy Watchdog Reconnect ngay</span>
              </button>
            </div>
          </div>

          {/* Nhật ký Watchdog xoay vòng */}
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-slate-900 dark:text-white">
              Nhật ký Watchdog & Xoay vòng Log (<code className="font-mono">logs/watchdog.log</code>)
            </div>
            <pre className="p-3 rounded-lg bg-slate-950 text-slate-300 text-xs font-mono overflow-x-auto max-h-[150px] overflow-y-auto leading-relaxed">
              {watchdogLogs.join('\n')}
            </pre>
          </div>

          {/* Khuyến nghị bảo vệ pin khi cắm sạc 24/7 */}
          <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 space-y-1 leading-relaxed">
            <div className="font-semibold text-slate-900 dark:text-white">
              Khuyến nghị an toàn Pin khi cắm sạc 24/7 trên LG G8X ThinQ (Không Root):
            </div>
            <p>
              Vì máy không root nên không can thiệp được file điều khiển dòng sạc trong kernel. Hãy cắm sạc qua{' '}
              <strong className="text-slate-900 dark:text-slate-200">Ổ cắm thông minh (Smart Plug / Tuya / Sonoff)</strong> hoặc ổ cắm hẹn giờ cơ học:
              cấu hình bật sạc 30 phút mỗi 3 tiếng (hoặc tự động ngắt khi <code className="font-mono">/healthz</code> báo pin &ge; 80% và bật lại khi &le; 40%) để tránh phồng pin Li-ion.
            </p>
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 5: TOÀN BỘ SCRIPT TERMUX:BOOT, SUPERVISOR, WATCHDOG & SCRCPY H.264
         ===================================================================== */}
      {activeTab === 'scripts' && (
        <div className="space-y-4 max-h-[470px] overflow-y-auto pr-1">
          <div className="p-3.5 rounded-lg border border-sky-200 dark:border-sky-900 bg-sky-50/70 dark:bg-sky-950/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-slate-900 dark:text-white">
                Gói mã nguồn chuẩn đẩy lên GitHub (g8x-cloud-phone-github.tar.gz)
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                Đã lọc sạch <code className="font-mono">node_modules</code>, <code className="font-mono">.env</code> và{' '}
                <code className="font-mono">logs/</code>. Giải nén và push thẳng lên GitHub hoặc kéo về Termux.
              </p>
            </div>
            <a
              href="/g8x-cloud-phone-github.tar.gz"
              download="g8x-cloud-phone-github.tar.gz"
              className="px-3.5 py-2 text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Tải Gói GitHub (.tar.gz)</span>
            </a>
          </div>

          {TERMUX_SCRIPTS_DOCS.map((doc) => (
            <div
              key={doc.id}
              className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-xs font-bold text-slate-900 dark:text-white">{doc.title}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{doc.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopyScript(doc.id, doc.content)}
                  className="px-2.5 py-1 text-xs font-medium bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded flex items-center gap-1 shrink-0 text-slate-700 dark:text-slate-200"
                >
                  {copiedId === doc.id ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedId === doc.id ? 'Đã chép' : 'Sao chép'}</span>
                </button>
              </div>
              <pre className="p-3 rounded bg-slate-950 text-slate-200 text-xs font-mono overflow-x-auto leading-relaxed">
                {doc.content}
              </pre>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
