import { useState, useRef, useEffect } from "react";
import { FormattedMessage } from "react-intl";
import { LogOut, Globe, Menu, Wifi, WifiOff, User, ChevronDown, Bell, MessageCircle, Shield, Sun, Moon, KeyRound } from "lucide-react";
import { useNavigate } from "react-router";
import { useAuth } from "@/auth/useAuth";
import { useLocale } from "@/i18n/IntlSetup";
import { useTheme } from "@/theme/ThemeProvider";

interface HeaderProps {
  onMenuToggle: () => void;
}

export function Header({ onMenuToggle }: HeaderProps) {
  const { displayName, roles, signOut } = useAuth();
  const { locale, setLocale, supportedLocales } = useLocale();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const isOnline = navigator.onLine;
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  const cycleLocale = () => {
    const idx = supportedLocales.indexOf(locale);
    const next = supportedLocales[(idx + 1) % supportedLocales.length];
    if (next) setLocale(next);
  };

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    }
    if (profileOpen) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [profileOpen]);

  const highestRole = roles.includes("admin")
    ? "Admin"
    : roles.includes("elder")
      ? "Elder"
      : roles.includes("publisher")
        ? "Publisher"
        : "Viewer";

  return (
    <header className="flex items-center justify-between h-14 px-4 border-b border-[var(--border)] bg-[var(--bg-1)]">
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuToggle}
          className="lg:hidden p-2 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
          aria-label="Toggle menu"
        >
          <Menu size={20} />
        </button>
      </div>

      <div className="flex items-center gap-1">
        {/* Hub connection status */}
        <div
          className={`flex items-center justify-center w-7 h-7 rounded-full ${
            isOnline
              ? "bg-[#22c55e14] text-[var(--green)]"
              : "bg-[#f5970b14] text-[var(--amber)]"
          }`}
          title={isOnline ? "Hub connected" : "Offline"}
        >
          {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
        </div>

        {/* Language toggle */}
        <button
          onClick={cycleLocale}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-sm)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
          title="Switch language"
        >
          <Globe size={14} />
          {locale.split("-")[0]?.toUpperCase()}
        </button>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        {/* Messages */}
        <button
          onClick={() => navigate("/chat")}
          className="relative p-2 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--amber)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
          title="Chat"
        >
          <MessageCircle size={16} />
        </button>

        {/* Notification bell */}
        <button
          className="relative p-2 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
          title="Notifications"
        >
          <Bell size={16} />
        </button>

        {/* Profile dropdown */}
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => setProfileOpen((o) => !o)}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-sm)] text-sm hover:bg-[var(--glass)] transition-colors cursor-pointer"
          >
            <div className="w-7 h-7 rounded-full bg-[var(--glass-2)] flex items-center justify-center">
              <User size={14} className="text-[var(--text-muted)]" />
            </div>
            <span className="text-[var(--text-muted)] hidden sm:inline text-sm">
              {displayName}
            </span>
            <ChevronDown
              size={12}
              className={`text-[var(--text-muted)] hidden sm:inline transition-transform ${profileOpen ? "rotate-180" : ""}`}
            />
          </button>

          {profileOpen && (
            <div className="absolute right-0 top-full mt-1 w-56 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-1)] shadow-lg z-50">
              {/* User info */}
              <div className="px-4 py-3 border-b border-[var(--border)]">
                <p className="text-sm font-medium text-[var(--text)]">{displayName}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <Shield size={11} className="text-[var(--amber)]" />
                  <span className="text-xs text-[var(--text-muted)]">{highestRole}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="p-1">
                <button
                  onClick={() => {
                    setProfileOpen(false);
                    navigate("/profile");
                  }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 rounded-[var(--radius-sm)] text-sm text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
                >
                  <KeyRound size={14} />
                  <FormattedMessage id="nav.profile.security" />
                </button>
                <button
                  onClick={() => {
                    setProfileOpen(false);
                    signOut();
                  }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 rounded-[var(--radius-sm)] text-sm text-[var(--text-muted)] hover:text-[var(--red)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
                >
                  <LogOut size={14} />
                  <FormattedMessage id="auth.logout" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
