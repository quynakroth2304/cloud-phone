#!/data/data/com.termux/files/usr/bin/bash
# ==============================================================================
# G8X Cloud Phone - ADB & Thermal Watchdog (Chạy mỗi 30 giây)
# - Kiểm tra trạng thái ADB (device / offline / mất kết nối)
# - Tự động kết nối lại với Exponential Backoff (5s -> 10s -> 20s -> 40s -> 60s)
# - Xử lý khi LG G8X đổi mạng Wi-Fi làm ADB Wireless Debugging bị offline
# - Ghi log có xoay vòng (giới hạn 2MB)
# ==============================================================================

export PATH="/data/data/com.termux/files/usr/bin:$PATH"
APP_DIR="${APP_DIR:-$(pwd)}"
LOG_FILE="$APP_DIR/logs/watchdog.log"
MAX_LOG_BYTES=$((2 * 1024 * 1024)) # 2 MB

mkdir -p "$APP_DIR/logs"

if [ -f "$APP_DIR/.env" ]; then
  source "$APP_DIR/.env"
fi

ADB_HOST="${ADB_HOST:-127.0.0.1}"
ADB_PORT="${ADB_PORT:-5555}"
ADB_TARGET="${ADB_HOST}:${ADB_PORT}"

BACKOFF_ATTEMPT=0

log_msg() {
  if [ -f "$LOG_FILE" ]; then
    local size
    size=$(stat -c%s "$LOG_FILE" 2>/dev/null || wc -c < "$LOG_FILE")
    if [ "$size" -ge "$MAX_LOG_BYTES" ]; then
      mv "$LOG_FILE" "${LOG_FILE}.1"
    fi
  fi
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [WATCHDOG] $1" >> "$LOG_FILE"
}

log_msg "Khởi động Watchdog giám sát ADB ($ADB_TARGET) và sức khỏe hệ thống..."

while true; do
  # Kiểm tra danh sách thiết bị ADB
  STATE=$(adb -s "$ADB_TARGET" get-state 2>/dev/null)

  if [ "$STATE" = "device" ]; then
    if [ "$BACKOFF_ATTEMPT" -gt 0 ]; then
      log_msg "Đã khôi phục kết nối ADB thành công tới $ADB_TARGET sau $BACKOFF_ATTEMPT lần thử!"
      BACKOFF_ATTEMPT=0
    fi

    # Kiểm tra endpoint /healthz của Web Panel
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/healthz 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" != "200" ]; then
      log_msg "CẢNH BÁO: Endpoint /healthz trả về mã $HTTP_CODE"
    fi

    sleep 30
  else
    BACKOFF_ATTEMPT=$((BACKOFF_ATTEMPT + 1))
    # Tính thời gian chờ Exponential Backoff: 5 * 2^(attempt-1), tối đa 60 giây
    DELAY=$((5 * (1 << (BACKOFF_ATTEMPT - 1))))
    if [ "$DELAY" -gt 60 ]; then
      DELAY=60
    fi

    log_msg "ADB mất kết nối (trạng thái: ${STATE:-disconnected}). Lần thử #$BACKOFF_ATTEMPT..."

    # Nếu bị offline do đổi Wi-Fi, thực hiện disconnect trước rồi reconnect
    adb disconnect "$ADB_TARGET" >/dev/null 2>&1
    adb start-server >/dev/null 2>&1
    CONNECT_OUT=$(adb connect "$ADB_TARGET" 2>&1)
    log_msg "Kết quả adb connect: $CONNECT_OUT"

    # Nếu đã bật adb tcpip 5555 trước đó, đảm bảo kết nối lại cổng 5555
    if echo "$CONNECT_OUT" | grep -qiE "refused|failed|cannot"; then
      log_msg "Chờ $DELAY giây trước khi thử kết nối lại..."
    fi

    sleep "$DELAY"
  fi
done
