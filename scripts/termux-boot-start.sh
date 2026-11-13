#!/data/data/com.termux/files/usr/bin/bash
# ==============================================================================
# G8X Cloud Phone - Termux:Boot Auto-Start Script
# Đường dẫn cài đặt trên máy: ~/.termux/boot/start.sh
# Quyền thực thi: chmod +x ~/.termux/boot/start.sh
# ==============================================================================

export PATH="/data/data/com.termux/files/usr/bin:$PATH"
export HOME="/data/data/com.termux/files/home"
APP_DIR="$HOME/g8x-cloud-phone"
LOG_DIR="$APP_DIR/logs"

mkdir -p "$LOG_DIR"

# 1. Giữ CPU luôn thức (ngăn Android Doze Mode đóng băng tiến trình Termux khi tắt màn hình)
termux-wake-lock

echo "[$(date '+%Y-%m-%d %H:%M:%S')] === Khởi động G8X Cloud Phone từ Termux:Boot ===" >> "$LOG_DIR/boot.log"

# 2. Đợi hệ thống mạng Android ổn định sau khi khởi động lại máy
sleep 10

# 3. Khởi động ADB Server cục bộ (chỉ lắng nghe trên 127.0.0.1)
adb start-server >> "$LOG_DIR/boot.log" 2>&1

# 4. Kết nối vào cổng ADB nội bộ (mặc định 5555 hoặc cổng lưu trong .env)
if [ -f "$APP_DIR/.env" ]; then
  source "$APP_DIR/.env"
fi
ADB_TARGET="${ADB_HOST:-127.0.0.1}:${ADB_PORT:-5555}"
adb connect "$ADB_TARGET" >> "$LOG_DIR/boot.log" 2>&1

# 5. Khởi chạy Supervisor quản lý đồng thời: Web Panel (127.0.0.1:3000), Cloudflared & Watchdog
cd "$APP_DIR" || exit 1
nohup bash "$APP_DIR/scripts/supervisor.sh" >> "$LOG_DIR/supervisor.log" 2>&1 &

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Đã kích hoạt Supervisor thành công (PID: $!)" >> "$LOG_DIR/boot.log"
