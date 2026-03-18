import { NavLink } from "react-router";
import { FormattedMessage } from "react-intl";
import {
  LayoutDashboard,
  Users,
  Map,
  Calendar,
  Handshake,
  Settings as SettingsIcon,
} from "lucide-react";
import { useAuth } from "@/auth/useAuth";

interface NavItem {
  to: string;
  labelId: string;
  icon: React.ElementType;
  minRole: "viewer" | "publisher" | "elder" | "admin";
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", labelId: "nav.dashboard", icon: LayoutDashboard, minRole: "viewer" },
  { to: "/publishers", labelId: "nav.publishers", icon: Users, minRole: "elder" },
  { to: "/territories", labelId: "nav.territories", icon: Map, minRole: "elder" },
  { to: "/meetings", labelId: "nav.meetings", icon: Calendar, minRole: "publisher" },
  { to: "/sharing", labelId: "nav.sharing", icon: Handshake, minRole: "admin" },
  { to: "/settings", labelId: "nav.settings", icon: SettingsIcon, minRole: "admin" },
];

const ROLE_LEVELS: Record<string, number> = {
  viewer: 0,
  publisher: 1,
  elder: 2,
  admin: 3,
};

interface SidebarProps {
  onNavigate?: () => void;
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const { roles } = useAuth();

  const userLevel = Math.max(
    ...roles.map((r) => ROLE_LEVELS[r] ?? 0),
    0,
  );

  const visibleItems = NAV_ITEMS.filter(
    (item) => userLevel >= (ROLE_LEVELS[item.minRole] ?? 0),
  );

  return (
    <nav className="flex flex-col gap-1 p-3">
      {visibleItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-sm)] text-sm font-medium transition-colors ${
              isActive
                ? "bg-[var(--glass-2)] text-[var(--amber)]"
                : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)]"
            }`
          }
        >
          <item.icon size={18} strokeWidth={1.8} />
          <FormattedMessage id={item.labelId} />
        </NavLink>
      ))}
    </nav>
  );
}
