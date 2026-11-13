import React, { useState, useRef } from 'react';
import {
  Power,
  Volume2,
  VolumeX,
  RotateCw,
  Camera,
  Send,
  Pause,
  Play,
  Home,
  ArrowLeft,
  Square,
  Flame,
  WifiOff,
} from 'lucide-react';
import {
  mapViewportToDeviceCoords,
  getActiveScreenDimensions,
  ScreenRotation,
  BatteryTelemetry,
  ThermalPolicyDecision,
} from '../utils/cloudPhoneLogic';

interface PhoneViewportProps {
  svgFrame: string | null;
  streamConnected: boolean;
  viewerPaused: boolean;
  onToggleViewerPause: () => void;
  adbConnected: boolean;
  screenAwake: boolean;
  rotation: ScreenRotation;
  physicalWidth: number;
  physicalHeight: number;
  requestedFps: number;
  jpegQuality: number;
  resolutionScale: number;
  streamMode: 'mvp_jpeg' | 'scrcpy_h264';
  battery: BatteryTelemetry;
  thermal: ThermalPolicyDecision;
  onUpdateStreamConfig: (patch: Record<string, any>) => void;
  onTap: (x: number, y: number) => void;
  onSwipe: (x1: number, y1: number, x2: number, y2: number, durationMs: number) => void;
  onKeyEvent: (key: string) => void;
  onSendText: (text: string, method: string) => Promise<void>;
  onReconnectAdb: () => void;
}

export function PhoneViewport({
  svgFrame,
  streamConnected,
  viewerPaused,
  onToggleViewerPause,
  adbConnected,
  screenAwake,
  rotation,
  physicalWidth,
  physicalHeight,
  requestedFps,
  jpegQuality,
  resolutionScale,
  streamMode,
  thermal,
  onUpdateStreamConfig,
  onTap,
  onSwipe,
  onKeyEvent,
  onSendText,
  onReconnectAdb,
}: PhoneViewportProps) {
  const screenRef = useRef<HTMLDivElement | null>(null);
  const pointerDownRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const [textInput, setTextInput] = useState('');
  const [textMethod, setTextMethod] = useState<'auto' | 'adbkeyboard' | 'clipboard' | 'input_text'>('auto');
  const [lastMappedCoord, setLastMappedCoord] = useState<{ x: number; y: number }>({ x: 540, y: 1170 });
  const [sendingText, setSendingText] = useState(false);

  const isLandscape = rotation === 1 || rotation === 3;
  const activeDims = getActiveScreenDimensions({ physicalWidth, physicalHeight, rotation });

  const computeDevicePoint = (clientX: number, clientY: number) => {
    const el = screenRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    return mapViewportToDeviceCoords(
      clientX - rect.left,
      clientY - rect.top,
      rect.width,
      rect.height,
      { physicalWidth, physicalHeight, rotation }
    );
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const pt = computeDevicePoint(e.clientX, e.clientY);
    pointerDownRef.current = { x: pt.x, y: pt.y, time: Date.now() };
    setLastMappedCoord(pt);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointerDownRef.current) return;
    const start = pointerDownRef.current;
    pointerDownRef.current = null;

    const end = computeDevicePoint(e.clientX, e.clientY);
    setLastMappedCoord(end);

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dist = Math.hypot(dx, dy);
    const duration = Math.max(80, Math.min(1200, Date.now() - start.time));

    // Nếu khoảng cách kéo > 35px trên độ phân giải thực thì tính là Swipe, ngược lại là Tap
    if (dist > 35) {
      onSwipe(start.x, start.y, end.x, end.y, duration);
    } else {
      onTap(end.x, end.y);
    }
  };

  const handleWheelScroll = (e: React.WheelEvent<HTMLDivElement>) => {
    const center = computeDevicePoint(e.clientX, e.clientY);
    const deltaY = e.deltaY > 0 ? -420 : 420; // Cuộn chuột xuống = vuốt màn hình từ dưới lên
    const targetY = Math.max(100, Math.min(activeDims.height - 100, center.y + deltaY));
    onSwipe(center.x, center.y, center.x, targetY, 220);
  };

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim()) return;
    setSendingText(true);
    try {
      await onSendText(textInput, textMethod);
      setTextInput('');
    } finally {
      setSendingText(false);
    }
  };

  const handleRotate = () => {
    const nextRotation = ((rotation + 1) % 4) as ScreenRotation;
    onUpdateStreamConfig({ rotation: nextRotation });
  };

  return (
    <section
      aria-label="Khung điều khiển màn hình LG G8X ThinQ"
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 flex flex-col justify-between gap-4"
    >
      {/* Thanh điều khiển chất lượng Stream & chế độ MVP / WebCodecs */}
      <div className="flex flex-col gap-2.5 pb-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => onUpdateStreamConfig({ streamMode: 'mvp_jpeg' })}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                streamMode === 'mvp_jpeg'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              MVP: Screencap WS
            </button>
            <button
              type="button"
              onClick={() => onUpdateStreamConfig({ streamMode: 'scrcpy_h264' })}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                streamMode === 'scrcpy_h264'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Nâng cao: Scrcpy H.264
            </button>
          </div>

          <button
            type="button"
            onClick={onToggleViewerPause}
            className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
              viewerPaused
                ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-500'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            {viewerPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            <span>{viewerPaused ? 'Tiếp tục xem' : 'Dừng xem (Nghỉ CPU)'}</span>
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
              <span>Tốc độ:</span>
              <select
                aria-label="Chọn tốc độ khung hình FPS"
                value={requestedFps}
                onChange={(e) => onUpdateStreamConfig({ requestedFps: Number(e.target.value) })}
                className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-mono tabular-nums"
              >
                <option value={3}>3 FPS</option>
                <option value={5}>5 FPS</option>
                <option value={8}>8 FPS</option>
                <option value={12}>12 FPS</option>
              </select>
            </label>

            <label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
              <span>Độ phân giải:</span>
              <select
                aria-label="Chọn độ phân giải hiển thị"
                value={resolutionScale}
                onChange={(e) => onUpdateStreamConfig({ resolutionScale: Number(e.target.value) })}
                className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-mono tabular-nums"
              >
                <option value={0.5}>50% (540p)</option>
                <option value={0.75}>75% (810p)</option>
                <option value={1}>100% (1080p)</option>
              </select>
            </label>
          </div>

          <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">
            {streamMode === 'scrcpy_h264' ? 'WebCodecs: avc1.42E01E' : `JPEG Q${jpegQuality}`}
          </span>
        </div>
      </div>

      {/* Cảnh báo nhiệt độ cao hoặc mất kết nối ADB */}
      {thermal.state !== 'normal' && (
        <div
          role="status"
          className={`px-3 py-2 rounded-lg text-xs flex items-center gap-2 border ${
            thermal.state === 'critical_paused'
              ? 'bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-900 text-red-700 dark:text-red-300'
              : 'bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300'
          }`}
        >
          <Flame className="w-4 h-4 shrink-0" />
          <span>{thermal.messageVi}</span>
        </div>
      )}

      {/* Khung thân máy LG G8X ThinQ */}
      <div className="flex flex-col lg:flex-row items-center justify-center gap-4 my-auto">
        {/* Vỏ điện thoại */}
        <div
          className={`relative rounded-[28px] p-3 bg-slate-900 border-2 border-slate-700 shadow-lg transition-all ${
            isLandscape ? 'w-full max-w-[640px]' : 'w-[300px] sm:w-[336px]'
          }`}
        >
          {/* Tai thỏ giọt nước đặc trưng của LG G8X ThinQ */}
          {!isLandscape && (
            <div className="w-16 h-2 bg-slate-800 rounded-full mx-auto mb-2 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-slate-950" />
            </div>
          )}

          {/* Vùng màn hình cảm ứng (Click = Tap, Kéo = Swipe, Lăn chuột = Scroll) */}
          <div
            ref={screenRef}
            data-testid="g8x-screen-surface"
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onWheel={handleWheelScroll}
            style={{ aspectRatio: isLandscape ? '2340 / 1080' : '1080 / 2340' }}
            className="relative w-full rounded-[18px] overflow-hidden bg-slate-950 cursor-crosshair select-none touch-none border border-slate-800"
          >
            {viewerPaused ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-slate-950 text-slate-300 space-y-3">
                <Pause className="w-8 h-8 text-sky-400" />
                <div className="text-sm font-semibold">Đã ngắt WebSocket để tiết kiệm Pin & Nhiệt</div>
                <p className="text-xs text-slate-400">
                  Khi không có người xem, tiến trình <code className="font-mono">adb exec-out screencap</code> dừng hoàn toàn (0% CPU).
                </p>
                <button
                  type="button"
                  onClick={onToggleViewerPause}
                  className="px-4 py-2 text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white rounded-lg"
                >
                  Kết nối lại luồng hình ảnh
                </button>
              </div>
            ) : !adbConnected ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-slate-950 text-slate-300 space-y-3">
                <WifiOff className="w-8 h-8 text-amber-400" />
                <div className="text-sm font-semibold">ADB Localhost đang Offline</div>
                <p className="text-xs text-slate-400">
                  Watchdog đang thực hiện kết nối lại với thuật toán Exponential Backoff...
                </p>
                <button
                  type="button"
                  onClick={onReconnectAdb}
                  className="px-4 py-2 text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white rounded-lg"
                >
                  Kết nối lại ADB ngay
                </button>
              </div>
            ) : thermal.streamPaused ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-slate-950 text-red-200 space-y-2">
                <Flame className="w-8 h-8 text-red-500" />
                <div className="text-sm font-semibold">Đã tạm dừng Stream do Quá Nhiệt (&ge; 45°C)</div>
                <p className="text-xs text-slate-400">
                  Vẫn có thể bấm nút Nguồn để tắt màn hình hoặc hạ nhiệt độ trong tab Watchdog.
                </p>
              </div>
            ) : svgFrame ? (
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(svgFrame)}`}
                alt="Màn hình trực tiếp LG G8X ThinQ"
                draggable={false}
                className="w-full h-full object-cover pointer-events-none"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-400 font-mono">
                Đang đồng bộ khung hình từ ADB...
              </div>
            )}
          </div>

          {/* 3 Nút điều hướng Android (Back, Home, Recents) ngay dưới màn hình */}
          <div className="mt-2.5 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => onKeyEvent('BACK')}
              aria-label="Phím Quay lại (Back)"
              className="py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center gap-1.5 text-xs font-medium transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
            <button
              type="button"
              onClick={() => onKeyEvent('HOME')}
              aria-label="Phím Màn hình chính (Home)"
              className="py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center gap-1.5 text-xs font-medium transition-colors"
            >
              <Home className="w-3.5 h-3.5" />
              <span>Home</span>
            </button>
            <button
              type="button"
              onClick={() => onKeyEvent('RECENTS')}
              aria-label="Phím Đa nhiệm (Recents)"
              className="py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center gap-1.5 text-xs font-medium transition-colors"
            >
              <Square className="w-3.5 h-3.5" />
              <span>Đa nhiệm</span>
            </button>
          </div>
        </div>

        {/* Cột nút cứng vật lý bên cạnh (Nguồn, Âm lượng, Xoay, Chụp ảnh) */}
        <div className="flex lg:flex-col flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => onKeyEvent('POWER')}
            aria-label="Nút Nguồn Bật/Tắt màn hình"
            className={`px-3 py-2 rounded-lg text-xs font-medium border flex items-center gap-2 transition-colors whitespace-nowrap ${
              screenAwake
                ? 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 border-slate-300 dark:border-slate-700 hover:bg-slate-200'
                : 'bg-amber-600 text-white border-amber-600 hover:bg-amber-500'
            }`}
          >
            <Power className="w-3.5 h-3.5" />
            <span>{screenAwake ? 'Tắt màn hình' : 'Bật màn hình'}</span>
          </button>

          <button
            type="button"
            onClick={() => onKeyEvent('VOLUME_UP')}
            aria-label="Tăng âm lượng"
            className="px-3 py-2 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 flex items-center gap-2 whitespace-nowrap"
          >
            <Volume2 className="w-3.5 h-3.5" />
            <span>Âm lượng +</span>
          </button>

          <button
            type="button"
            onClick={() => onKeyEvent('VOLUME_DOWN')}
            aria-label="Giảm âm lượng"
            className="px-3 py-2 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 flex items-center gap-2 whitespace-nowrap"
          >
            <VolumeX className="w-3.5 h-3.5" />
            <span>Âm lượng -</span>
          </button>

          <button
            type="button"
            onClick={handleRotate}
            aria-label="Xoay màn hình"
            className="px-3 py-2 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 flex items-center gap-2 whitespace-nowrap"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>Xoay ({rotation * 90}°)</span>
          </button>

          <a
            href="/api/screen/screenshot"
            download={`g8x-screencap-${Date.now()}.svg`}
            className="px-3 py-2 rounded-lg text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white flex items-center gap-2 whitespace-nowrap"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Chụp tải về</span>
          </a>
        </div>
      </div>

      {/* Thanh nhập văn bản Tiếng Việt & Ký tự đặc biệt */}
      <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
        <form onSubmit={handleTextSubmit} className="flex flex-col sm:flex-row gap-2">
          <select
            aria-label="Phương thức truyền văn bản"
            value={textMethod}
            onChange={(e) => setTextMethod(e.target.value as any)}
            className="px-2.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 shrink-0"
          >
            <option value="auto">Tự động (Tiếng Việt = ADBKeyboard)</option>
            <option value="adbkeyboard">ADBKeyboard (Base64 Broadcast)</option>
            <option value="clipboard">Clipboard + Paste (Android 10+)</option>
            <option value="input_text">ADB input text (Chỉ ASCII)</option>
          </select>

          <div className="flex-1 flex gap-2">
            <input
              type="text"
              aria-label="Nhập văn bản gửi sang điện thoại"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Gõ tiếng Việt hoặc lệnh cần gửi sang G8X..."
              className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
            <button
              type="submit"
              disabled={sendingText || !textInput.trim()}
              className="px-3.5 py-2 text-xs font-semibold bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Gửi Text</span>
            </button>
          </div>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
          <span>
            WM Size: {activeDims.width}×{activeDims.height}px · Tọa độ chạm: ({lastMappedCoord.x}, {lastMappedCoord.y})
          </span>
          <span>
            Chất lượng JPEG: {jpegQuality}% · Luồng WS: {streamConnected && !viewerPaused ? 'ĐANG MỞ' : 'ĐÃ DỪNG'}
          </span>
        </div>
      </div>
    </section>
  );
}
