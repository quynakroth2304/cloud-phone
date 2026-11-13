#!/data/data/com.termux/files/usr/bin/bash
# ==============================================================================
# G8X Cloud Phone - Process Supervisor 24/7 (Không cần root / systemd)
# Tự động khởi động lại Web Panel, Cloudflare Tunnel và ADB Watchdog nếu bị tắt.
# Kèm cơ chế xoay vòng file log (giới hạn 5MB/file tránh đầy bộ nhớ G8X).
# ==============================================================================

export PATH="/data/data/com.termux/files/usr/bin:$PATH"
APP_DIR="${APP_DIR:-$(pwd)}"
LOG_DIR="$APP_DIR/logs"
MAX_LOG_BYTES=$((5 * 1024 * 1024)) # 5 MB

mkdir -p "$LOG_DIR"

# Hàm xoay vòng file log khi vượt quá 5MB
rotate_log() {
  local file="$1"
  if [ -f "$file" ]; then
    local size
    size=$(stat -c%s "$file" 2>/dev/null || wc -c < "$file")
    if [ "$size" -ge "$MAX_LOG_BYTES" ]; then
      mv "$file" "${file}.1"
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] Đã xoay vòng log $file (vượt 5MB)" > "$file"
    fi
  fi
}

# 1. Vòng lặp duy trì Web Panel Node.js (chỉ bind 127.0.0.1:3000)
run_panel_loop() {
  while true; do
    rotate_log "$LOG_DIR/panel.log"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [SUPERVISOR] Đang chạy G8X Web Panel trên 127.0.0.1:3000..." >> "$LOG_DIR/panel.log"
    HOST=127.0.0.1 PORT=3000 npm start >> "$LOG_DIR/panel.log" 2>&1
    EXIT_CODE=$?
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [SUPERVISOR] Web Panel dừng (mã: $EXIT_CODE). Tự khởi động lại sau 3 giây..." >> "$LOG_DIR/panel.log"
    sleep 3
  done
}

# 2. Vòng lặp duy trì Cloudflare Tunnel (HTTPS từ xa không cần mở port router)
run_cloudflared_loop() {
  while true; do
    rotate_log "$LOG_DIR/cloudflared.log"
    if [ -n "$CLOUDFLARE_TUNNEL_TOKEN" ]; then
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] [SUPERVISOR] Khởi chạy Cloudflare Named Tunnel..." >> "$LOG_DIR/cloudflared.log"
      cloudflared tunnel --no-autoupdate run --token "$CLOUDFLARE_TUNNEL_TOKEN" >> "$LOG_DIR/cloudflared.log" 2>&1
    else
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] [SUPERVISOR] Khởi chạy Cloudflare Quick Tunnel -> http://127.0.0.1:3000..." >> "$LOG_DIR/cloudflared.log"
      cloudflared tunnel --no-autoupdate --url http://127.0.0.1:3000 >> "$LOG_DIR/cloudflared.log" 2>&1
    fi
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [SUPERVISOR] Cloudflared ngắt kết nối (do đổi Wi-Fi hoặc mất mạng). Thử lại sau 5 giây..." >> "$LOG_DIR/cloudflared.log"
    sleep 5
  done
}

# 3. Khởi chạy đồng thời 3 tiến trình nền: Panel, Cloudflared, và Watchdog
run_panel_loop &
PANEL_PID=$!

run_cloudflared_loop &
CF_PID=$!

bash "$APP_DIR/scripts/watchdog.sh" &
WD_PID=$!

trap "kill $PANEL_PID $CF_PID $WD_PID 2>/dev/null; exit 0" SIGINT SIGTERM

wait
