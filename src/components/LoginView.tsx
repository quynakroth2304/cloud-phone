import React, { useState } from 'react';
import { Lock, ShieldCheck, Terminal, Eye, EyeOff, ArrowRight, Sun, Moon } from 'lucide-react';

interface LoginViewProps {
  onLoginSuccess: () => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
}

export function LoginView({ onLoginSuccess, darkMode, onToggleDarkMode }: LoginViewProps) {
  const [password, setPassword] = useState('g8x-admin-2026');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!password.trim()) {
      setError('Vui lòng nhập mật khẩu quản trị.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Đăng nhập thất bại.');
      } else {
        onLoginSuccess();
      }
    } catch {
      setError('Không thể kết nối tới máy chủ G8X Cloud Phone.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col justify-between transition-colors">
      {/* Top Bar */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <a href="/" className="text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0">
          G8X Cloud Phone
        </a>
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400">
          <span className="whitespace-nowrap shrink-0">LG G8X ThinQ (LM-G850)</span>
          <span aria-hidden="true">·</span>
          <span className="whitespace-nowrap shrink-0">Termux Localhost 127.0.0.1:3000</span>
          <span aria-hidden="true">·</span>
          <span className="whitespace-nowrap shrink-0">Cloudflare Tunnel HTTPS</span>
        </nav>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onToggleDarkMode}
            aria-label={darkMode ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
            className="px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
          >
            {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            <span>{darkMode ? 'Chế độ Sáng' : 'Chế độ Tối'}</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          {/* Cột thông tin kiến trúc bảo mật */}
          <div className="lg:col-span-7 flex flex-col justify-between p-8 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <div className="space-y-4">
              <div className="text-xs font-medium text-sky-600 dark:text-sky-400">
                Kiến trúc Self-Hosted 24/7 trên Termux (Không cần Root)
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                Điều khiển LG G8X ThinQ từ xa an toàn qua trình duyệt
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                Toàn bộ Web Panel (Node.js + Express + WebSocket) chạy trực tiếp trong Termux tại địa chỉ nội bộ{' '}
                <code className="font-mono text-xs px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded">127.0.0.1:3000</code>,
                giao tiếp với chính máy qua ADB Localhost và truy cập từ xa qua Cloudflare Tunnel có HTTPS.
              </p>

              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3 text-sm">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">Xác thực 2 lớp & Chống Brute-Force:</span>{' '}
                    <span className="text-slate-600 dark:text-slate-400">
                      Mật khẩu băm bcrypt lưu trong <code className="font-mono text-xs">.env</code>, Session Cookie{' '}
                      <code className="font-mono text-xs">httpOnly</code>, khóa IP 15 phút nếu sai quá 5 lần.
                    </span>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Terminal className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">Không mở Port Router:</span>{' '}
                    <span className="text-slate-600 dark:text-slate-400">
                      ADB và Express chỉ bind trên <code className="font-mono text-xs">127.0.0.1</code>. Kết hợp Cloudflare Access (Zero Trust Email OTP) làm lớp khóa thứ hai.
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              <span>SoC: Snapdragon 855</span>
              <span aria-hidden="true">·</span>
              <span>Display: 1080×2340 OLED</span>
              <span aria-hidden="true">·</span>
              <span>ADB: 127.0.0.1:5555</span>
            </div>
          </div>

          {/* Cột Form đăng nhập */}
          <div className="lg:col-span-5 p-8 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col justify-between">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Lock className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                  <span>Đăng nhập Quản trị viên</span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Nhập mật khẩu quản trị đã cấu hình trong tệp <code className="font-mono">.env</code>
                </p>
              </div>

              {error && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300"
                >
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="admin-password" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Mật khẩu Admin (Bcrypt)
                </label>
                <div className="relative">
                  <input
                    id="admin-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Nhập mật khẩu..."
                    className="w-full px-3.5 py-2.5 pr-10 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-lg transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <span>{loading ? 'Đang xác thực...' : 'Mở Bảng Điều Khiển G8X'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            <div className="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Mật khẩu mặc định trong <code className="font-mono">.env.example</code>:
              </div>
              <button
                type="button"
                onClick={() => setPassword('g8x-admin-2026')}
                className="w-full py-1.5 px-3 text-xs font-mono text-left bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded transition-colors"
              >
                Điền nhanh: g8x-admin-2026
              </button>
            </div>
          </div>
        </div>
      </main>

      <footer className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center justify-between gap-4">
        <span>G8X Cloud Phone — Giải pháp điều khiển Android không cần Root qua Termux</span>
        <span className="font-mono tabular-nums">Endpoint kiểm tra: GET /healthz</span>
      </footer>
    </div>
  );
}
