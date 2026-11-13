# G8X Cloud Phone — Điều khiển LG G8X ThinQ 24/7 qua Termux & Cloudflare Tunnel (Không Root)

Giải pháp biến chiếc **LG G8X ThinQ (LM-G850, Android 10/11/12, KHÔNG root)** thành một Cloud Phone tự chủ (Self-Hosted) hoạt động 24/7. Toàn bộ hệ thống (Node.js + Express + WebSocket + ADB Localhost + Cloudflare Tunnel) chạy gọn bên trong ứng dụng **Termux** ngay trên chính điện thoại.

---

## 1. Kiến trúc tổng thể

```text
[Trình duyệt máy tính / Điện thoại khác]
       │  HTTPS / WSS (Đã bảo vệ bởi Cloudflare Access + Cookie httpOnly)
       ▼
[Cloudflare Edge Network]
       │  Cloudflare Tunnel (cloudflared chạy trong Termux, KHÔNG mở port router)
       ▼
[Web Panel: Node.js + Express + ws (Chỉ bind 127.0.0.1:3000)]
       │  execFile('adb', ['-s', '127.0.0.1:5555', ...]) (Chống Command Injection)
       ▼
[ADB Server nội bộ (android-tools) ──► 127.0.0.1:5555 (Chính chiếc LG G8X ThinQ)]
```

### Nguyên tắc thiết kế cốt lõi:
- **Tuyệt đối không mở port ra Internet / LAN**: Web Panel chỉ lắng nghe ở `127.0.0.1:3000`, ADB chỉ kết nối nội bộ `127.0.0.1`.
- **Chỉ stream khi có người đang xem**: Khi bạn đóng tab trình duyệt hoặc bấm nút *"Dừng xem"*, số lượng kết nối WebSocket về `0`, máy chủ lập tức dừng vòng lặp `screencap` (CPU về 0%, máy mát hoàn toàn khi treo 24/7).
- **Bảo vệ nhiệt độ tự động**: Đọc `dumpsys battery` định kỳ. Nếu nhiệt độ $\ge 42^\circ\text{C}$, tự động hạ tốc độ khung hình xuống `2 FPS`. Nếu $\ge 45^\circ\text{C}$, tự động tạm dừng truyền hình ảnh để bảo vệ pin và chip Snapdragon 855.

---

## 2. Hướng dẫn cài đặt từng bước trên LG G8X ThinQ

### Bước 1: Cài đặt Termux và Termux:Boot đúng chuẩn F-Droid
> **Quan trọng**: Tuyệt đối KHÔNG cài Termux từ Google Play Store (bản trên Play Store đã ngừng cập nhật và lỗi kho gói).
1. Tải và cài đặt **F-Droid** từ trang chủ `https://f-droid.org`.
2. Mở F-Droid, tìm và cài đặt 2 ứng dụng:
   - **Termux** (`com.termux`)
   - **Termux:Boot** (`com.termux.boot`)
   - *(Khuyến nghị để gõ tiếng Việt)*: Tải thêm `ADBKeyBoard.apk` để hỗ trợ nhận văn bản Unicode/Tiếng Việt qua Broadcast Base64.

### Bước 2: Tắt tối ưu hóa pin (Chống Android kill Termux ngầm)
Trên giao diện LG UX của LG G8X ThinQ:
1. Vào **Cài đặt (Settings) → Pin (Battery) → Tiết kiệm pin (Power saving exclusions / Battery optimization)**.
2. Tìm **Termux** và **Termux:Boot** → Chọn **Không tối ưu hóa (Don't optimize / Unrestricted)**.
3. Mở ứng dụng **Termux:Boot** lên **ít nhất 1 lần** để Android đăng ký sự kiện `BOOT_COMPLETED`.
4. Trong Termux, cấp quyền truy cập bộ nhớ `/sdcard`:
   ```bash
   termux-setup-storage
   ```

### Bước 3: Cài đặt Node.js, ADB (`android-tools`) và `cloudflared`
Mở Termux trên LG G8X và chạy lần lượt:
```bash
pkg update && pkg upgrade -y
pkg install -y nodejs-lts android-tools cloudflared git curl termux-api
```

### Bước 4: Bật ADB Localhost trên chính chiếc LG G8X ThinQ
Vào **Cài đặt → Hệ thống → Tùy chọn nhà phát triển (Developer Options)**:
- Bật **Gỡ lỗi USB (USB Debugging)**.

#### Cách A: Nếu G8X chạy Android 11/12 (Có sẵn *Gỡ lỗi không dây / Wireless Debugging*)
1. Bật **Gỡ lỗi không dây (Wireless Debugging)**.
2. Chia đôi màn hình (Split-screen) giữa **Cài đặt** và **Termux**.
3. Chọn **Ghép nối thiết bị bằng mã ghép nối (Pair device with pairing code)**, xem địa chỉ `IP:PORT_PAIR` và mã 6 số, rồi gõ vào Termux:
   ```bash
   adb pair 127.0.0.1:PORT_PAIR MA_6_SO
   ```
4. Sau khi ghép nối xong, nhìn cổng chính của *Wireless Debugging* (ví dụ `PORT_MAIN`), chạy:
   ```bash
   adb connect 127.0.0.1:PORT_MAIN
   # Chuyển sang cổng cố định 5555 để không bị đổi cổng khi tắt/bật Wi-Fi:
   adb -s 127.0.0.1:PORT_MAIN tcpip 5555
   adb connect 127.0.0.1:5555
   ```

#### Cách B: Nếu G8X chạy Android 10 (hoặc muốn ổn định nhất)
1. Cắm cáp USB từ G8X vào máy tính 1 lần duy nhất, chạy:
   ```bash
   adb tcpip 5555
   ```
2. Rút cáp ra. Từ giờ bên trong Termux trên G8X chỉ cần chạy:
   ```bash
   adb connect 127.0.0.1:5555
   adb devices
   ```
   *(Lưu ý kỹ thuật thực tế: Cổng `adb tcpip 5555` sẽ giữ nguyên suốt quá trình máy chạy 24/7 kể cả khi đổi mạng Wi-Fi, chỉ mất khi khởi động lại máy hoàn toàn. Nếu chạy Android 11+, có thể kết nối lại qua Wireless Debugging ngay trên máy).*

---

## 3. Cấu hình `.env` và Mật khẩu Admin Bcrypt

Tại thư mục dự án `~/g8x-cloud-phone`:
```bash
cp .env.example .env
```
Để tạo mã băm bcrypt cho mật khẩu của riêng bạn (ví dụ mật khẩu `MatKhauCuaToi2026`), chạy lệnh sau trong Termux:
```bash
node -e "console.log(require('bcryptjs').hashSync('MatKhauCuaToi2026', 10))"
```
Sau đó dán chuỗi `$2b$10$...` vào biến `ADMIN_PASSWORD_HASH` trong file `.env`.

---

## 4. Tạo Cloudflare Tunnel & Bảo mật 2 lớp (Cloudflare Access)

### Cách 1: Quick Tunnel (Chạy ngay lập tức, không cần tên miền riêng)
```bash
cloudflared tunnel --url http://127.0.0.1:3000
```
Cloudflared sẽ sinh ra một đường dẫn HTTPS dạng `https://xxxx-xxxx.trycloudflare.com`.

### Cách 2: Named Tunnel cố định tên miền + Cloudflare Access (Khuyến nghị cho 24/7)
1. Truy cập bảng điều khiển **Cloudflare Zero Trust → Networks → Tunnels**.
2. Tạo một Tunnel mới tên là `g8x-cloud-phone`, chọn môi trường Debian/ARM64 và sao chép chuỗi `CLOUDFLARE_TUNNEL_TOKEN`.
3. Trỏ Public Hostname (ví dụ `g8x.tenmiencuaban.com`) về dịch vụ `http://127.0.0.1:3000`.
4. **Bật lớp bảo vệ thứ 2 với Cloudflare Access**:
   - Vào **Zero Trust → Access → Applications → Add an application → Self-hosted**.
   - Đặt Application Domain là `g8x.tenmiencuaban.com`.
   - Tạo Policy: **Action = Allow**, **Include = Emails** → Nhập địa chỉ email cá nhân của bạn.
   - Khi đó, bất kỳ ai truy cập `https://g8x.tenmiencuaban.com` đều phải nhập mã OTP gửi về email của bạn trên tầng Cloudflare trước khi thấy trang đăng nhập của G8X Cloud Phone!

---

## 5. Cấu hình chạy tự động 24/7 với Termux:Boot

```bash
mkdir -p ~/.termux/boot
cp ~/g8x-cloud-phone/scripts/termux-boot-start.sh ~/.termux/boot/start.sh
chmod +x ~/.termux/boot/start.sh
chmod +x ~/g8x-cloud-phone/scripts/*.sh
```

Khởi chạy ngay mà không cần đợi khởi động lại máy:
```bash
bash ~/.termux/boot/start.sh
```

---

## 6. Xử lý các lỗi thường gặp & Bảo vệ Pin 24/7

1. **Lỗi `adb offline` sau khi đổi mạng Wi-Fi**:
   - Khi Android chuyển đổi giữa các mạng Wi-Fi, giao diện mạng đổi IP làm daemon `adbd` treo kết nối cũ.
   - **Cách xử lý**: Script `scripts/watchdog.sh` đã tự động chạy `adb disconnect 127.0.0.1:5555` trước khi `adb connect 127.0.0.1:5555` lại với thuật toán Exponential Backoff. Bạn cũng có thể bấm nút **"Chạy Watchdog Reconnect ngay"** trên giao diện.
2. **Termux bị đóng ngầm sau vài giờ (Phantom Process Killer trên Android 12)**:
   - Đảm bảo `termux-wake-lock` đang bật (hiện trên thanh thông báo).
   - Nếu G8X đã lên Android 12, chạy lệnh sau qua ADB một lần để tắt giới hạn tiến trình con:
     ```bash
     adb -s 127.0.0.1:5555 shell "/system/bin/device_config set_sync_disabled_for_tests persistent && /system/bin/device_config put activity_manager max_phantom_processes 2147483647"
     ```
3. **Màn hình đen khi chụp ảnh (`screencap`)**:
   - Một số ứng dụng ngân hàng hoặc DRM bật cờ `FLAG_SECURE` chặn chụp màn hình qua ADB không root, hoặc màn hình vật lý đang ở chế độ khóa tắt hẳn. Hãy bấm nút **"Bật màn hình (Wakeup)"** trên thanh công cụ bên cạnh khung điện thoại.
4. **Chống phồng pin khi cắm sạc 24/7 (Rất quan trọng)**:
   - Vì máy không root nên không thể ghi trực tiếp vào `/sys/class/power_supply/battery/charging_enabled`.
   - **Giải pháp chuẩn**: Cắm củ sạc của LG G8X qua một **Ổ cắm thông minh (Smart Plug Wi-Fi như Tuya / Sonoff / Tapo)** hoặc **Ổ cắm hẹn giờ cơ học**. Hẹn giờ sạc 30 phút mỗi 3–4 tiếng (hoặc dùng Home Assistant đọc endpoint `GET /healthz` của G8X để bật ổ cắm khi `battery.level <= 40` và tắt ổ cắm khi `battery.level >= 80`). Giữ pin ở mức 40%–80% và nhiệt độ `< 38°C` giúp pin Li-ion bền bỉ hàng năm trời không bị phồng.
"# cloud-phone" 
