#!/data/data/com.termux/files/usr/bin/bash
# ==============================================================================
# G8X Cloud Phone - Scrcpy H.264 Hardware Encoder Stream Bridge (Nâng cao)
# Sử dụng chip giải mã/mã hóa phần cứng Snapdragon 855 trên LG G8X ThinQ
# để xuất luồng raw H.264 qua stdout cho WebCodecs API trên trình duyệt.
# ==============================================================================

export PATH="/data/data/com.termux/files/usr/bin:$PATH"
ADB_TARGET="${1:-127.0.0.1:5555}"
SCRCPY_SERVER_PATH="/data/data/com.termux/files/usr/share/scrcpy/scrcpy-server"

if [ ! -f "$SCRCPY_SERVER_PATH" ]; then
  echo "Lỗi: Chưa cài đặt gói scrcpy trong Termux. Hãy chạy: pkg install scrcpy" >&2
  exit 1
fi

# 1. Đẩy scrcpy-server vào bộ nhớ tạm của G8X
adb -s "$ADB_TARGET" push "$SCRCPY_SERVER_PATH" /data/local/tmp/scrcpy-server.jar >/dev/null 2>&1

# 2. Chạy scrcpy-server ở chế độ raw H.264 stream (không âm thanh, max_size 1080, bitrate 2Mbps, max_fps 24)
exec adb -s "$ADB_TARGET" exec-out \
  CLASSPATH=/data/local/tmp/scrcpy-server.jar \
  app_process / com.genymobile.scrcpy.Server 2.4 \
  tunnel_forward=true audio=false control=false cleanup=false \
  raw_stream=true max_size=1080 video_bit_rate=2000000 max_fps=24
