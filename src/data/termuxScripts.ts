export interface ScriptFileDoc {
  id: string;
  title: string;
  path: string;
  description: string;
  content: string;
}

export const TERMUX_SCRIPTS_DOCS: ScriptFileDoc[] = [
  {
    id: 'boot-script',
    title: '1. Termux:Boot Auto-Start (~/.termux/boot/start.sh)',
    path: '~/.termux/boot/start.sh',
    description: 'Tự động chạy khi LG G8X ThinQ khởi động lại: giữ CPU thức (termux-wake-lock), bật ADB Server nội bộ và kích hoạt Supervisor.',
    content: `#!/data/data/com.termux/files/usr/bin/bash
export PATH="/data/data/com.termux/files/usr/bin:$PATH"
export HOME="/data/data/com.termux/files/home"
APP_DIR="$HOME/g8x-cloud-phone"
LOG_DIR="$APP_DIR/logs"

mkdir -p "$LOG_DIR"

# 1. Giữ CPU luôn thức (ngăn Android Doze Mode đóng băng Termux khi tắt màn hình)
termux-wake-lock

echo "[$(date '+%Y-%m-%d %H:%M:%S')] === Khởi động G8X Cloud Phone từ Termux:Boot ===" >> "$LOG_DIR/boot.log"

# 2. Đợi hệ thống mạng Android ổn định sau khi khởi động lại máy
sleep 10

# 3. Khởi động ADB Server cục bộ (chỉ lắng nghe trên 127.0.0.1)
adb start-server >> "$LOG_DIR/boot.log" 2>&1

# 4. Kết nối vào cổng ADB nội bộ (mặc định 127.0.0.1:5555)
if [ -f "$APP_DIR/.env" ]; then
  source "$APP_DIR/.env"
fi
ADB_TARGET="\${ADB_HOST:-127.0.0.1}:\${ADB_PORT:-5555}"
adb connect "$ADB_TARGET" >> "$LOG_DIR/boot.log" 2>&1

# 5. Khởi chạy Supervisor quản lý Web Panel, Cloudflared & Watchdog
cd "$APP_DIR" || exit 1
nohup bash "$APP_DIR/scripts/supervisor.sh" >> "$LOG_DIR/supervisor.log" 2>&1 &`,
  },
  {
    id: 'supervisor-script',
    title: '2. Supervisor 24/7 (scripts/supervisor.sh)',
    path: '~/g8x-cloud-phone/scripts/supervisor.sh',
    description: 'Giám sát và tự động bật lại Node.js Panel (127.0.0.1:3000) và Cloudflare Tunnel nếu tiến trình bị dừng hoặc rớt mạng.',
    content: `#!/data/data/com.termux/files/usr/bin/bash
export PATH="/data/data/com.termux/files/usr/bin:$PATH"
APP_DIR="\${APP_DIR:-$(pwd)}"
LOG_DIR="$APP_DIR/logs"
MAX_LOG_BYTES=$((5 * 1024 * 1024)) # Giới hạn 5MB mỗi file log

mkdir -p "$LOG_DIR"

rotate_log() {
  local file="$1"
  if [ -f "$file" ]; then
    local size=$(stat -c%s "$file" 2>/dev/null || wc -c < "$file")
    if [ "$size" -ge "$MAX_LOG_BYTES" ]; then
      mv "$file" "\${file}.1"
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] Đã xoay vòng log $file" > "$file"
    fi
  fi
}

run_panel_loop() {
  while true; do
    rotate_log "$LOG_DIR/panel.log"
    HOST=127.0.0.1 PORT=3000 npm start >> "$LOG_DIR/panel.log" 2>&1
    sleep 3
  done
}

run_cloudflared_loop() {
  while true; do
    rotate_log "$LOG_DIR/cloudflared.log"
    if [ -n "$CLOUDFLARE_TUNNEL_TOKEN" ]; then
      cloudflared tunnel --no-autoupdate run --token "$CLOUDFLARE_TUNNEL_TOKEN" >> "$LOG_DIR/cloudflared.log" 2>&1
    else
      cloudflared tunnel --no-autoupdate --url http://127.0.0.1:3000 >> "$LOG_DIR/cloudflared.log" 2>&1
    fi
    sleep 5
  done
}

run_panel_loop &
run_cloudflared_loop &
bash "$APP_DIR/scripts/watchdog.sh" &
wait`,
  },
  {
    id: 'watchdog-script',
    title: '3. ADB Reconnect Watchdog (scripts/watchdog.sh)',
    path: '~/g8x-cloud-phone/scripts/watchdog.sh',
    description: 'Kiểm tra kết nối ADB mỗi 30 giây, tự động kết nối lại với thuật toán Exponential Backoff khi đổi Wi-Fi hoặc ADB bị offline.',
    content: `#!/data/data/com.termux/files/usr/bin/bash
export PATH="/data/data/com.termux/files/usr/bin:$PATH"
APP_DIR="\${APP_DIR:-$(pwd)}"
LOG_FILE="$APP_DIR/logs/watchdog.log"
ADB_TARGET="\${ADB_HOST:-127.0.0.1}:\${ADB_PORT:-5555}"
BACKOFF_ATTEMPT=0

while true; do
  STATE=$(adb -s "$ADB_TARGET" get-state 2>/dev/null)
  if [ "$STATE" = "device" ]; then
    BACKOFF_ATTEMPT=0
    sleep 30
  else
    BACKOFF_ATTEMPT=$((BACKOFF_ATTEMPT + 1))
    DELAY=$((5 * (1 << (BACKOFF_ATTEMPT - 1))))
    [ "$DELAY" -gt 60 ] && DELAY=60
    echo "[$(date '+%F %T')] ADB offline ($STATE). Thử kết nối lại lần #$BACKOFF_ATTEMPT..." >> "$LOG_FILE"
    adb disconnect "$ADB_TARGET" >/dev/null 2>&1
    adb start-server >/dev/null 2>&1
    adb connect "$ADB_TARGET" >> "$LOG_FILE" 2>&1
    sleep "$DELAY"
  fi
done`,
  },
  {
    id: 'scrcpy-h264',
    title: '4. Nâng cao: Scrcpy H.264 Raw Streamer (scripts/scrcpy-h264-bridge.sh)',
    path: '~/g8x-cloud-phone/scripts/scrcpy-h264-bridge.sh',
    description: 'Đẩy scrcpy-server vào /data/local/tmp và xuất luồng H.264 phần cứng (Snapdragon 855 MediaCodec) qua stdout để trình duyệt giải mã bằng WebCodecs.',
    content: `#!/data/data/com.termux/files/usr/bin/bash
# Yêu cầu gói scrcpy trong Termux: pkg install scrcpy
ADB_TARGET="\${1:-127.0.0.1:5555}"
SCRCPY_SERVER_PATH="/data/data/com.termux/files/usr/share/scrcpy/scrcpy-server"

# 1. Đẩy scrcpy-server vào bộ nhớ tạm của G8X
adb -s "$ADB_TARGET" push "$SCRCPY_SERVER_PATH" /data/local/tmp/scrcpy-server.jar >/dev/null 2>&1

# 2. Chạy scrcpy-server ở chế độ raw H.264 stream (không âm thanh, max-size 1080, bit-rate 2Mbps, max-fps 24)
exec adb -s "$ADB_TARGET" exec-out \\
  CLASSPATH=/data/local/tmp/scrcpy-server.jar \\
  app_process / com.genymobile.scrcpy.Server 2.4 \\
  tunnel_forward=true audio=false control=false cleanup=false \\
  raw_stream=true max_size=1080 video_bit_rate=2000000 max_fps=24`,
  },
];
