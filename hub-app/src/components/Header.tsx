import { FormattedMessage } from "react-intl";
import { LogOut, Globe, Menu } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { getLocaleContext } from "@/i18n/IntlSetup";

interface HeaderProps {
  onMenuToggle: () => void;
}

export function Header({ onMenuToggle }: HeaderProps) {
  const { displayName, signOut } = useAuth();
  const { locale, setLocale, supportedLocales } = getLocaleContext();

  const cycleLocale = () => {
    const idx = supportedLocales.indexOf(locale);
    const next = supportedLocales[(idx + 1) % supportedLocales.length];
    if (next) setLocale(next);
  };

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
        <span className="text-[var(--amber)] font-bold text-lg">Hubport</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={cycleLocale}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-sm)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
          title="Switch language"
        >
          <Globe size={14} />
          {locale.split("-")[0]?.toUpperCase()}
        </button>

        <span className="text-sm text-[var(--text-muted)] hidden sm:inline">
          {displayName}
        </span>

        <button
          onClick={() => signOut()}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-sm)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--red)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
          title="Sign out"
        >
          <LogOut size={14} />
          <span className="hidden sm:inline">
            <FormattedMessage id="auth.logout" />
          </span>
        </button>
      </div>
    </header>
  );
}
