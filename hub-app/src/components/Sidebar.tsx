import { NavLink } from "react-router";
import { FormattedMessage } from "react-intl";
import {
  LayoutDashboard,
  Users,
  UserCog,
  Map,
  Calendar,
  Handshake,
  Settings as SettingsIcon,
  ClipboardList,
  Shield,
} from "lucide-react";
import { usePermissions } from "@/auth/PermissionProvider";

interface NavItem {
  to: string;
  labelId: string;
  icon: React.ElementType;
  /** Permission required to see this nav item. Null = visible to all authenticated. */
  requiredPermission: string | null;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", labelId: "nav.dashboard", icon: LayoutDashboard, requiredPermission: null },
  { to: "/publishers", labelId: "nav.publishers", icon: Users, requiredPermission: "app:publishers.view" },
  { to: "/territories", labelId: "nav.territories", icon: Map, requiredPermission: "app:territories.view" },
  { to: "/meetings", labelId: "nav.meetings", icon: Calendar, requiredPermission: "app:meetings.view" },
  { to: "/users", labelId: "nav.users", icon: UserCog, requiredPermission: "app:roles.view" },
  { to: "/users/roles", labelId: "nav.roles", icon: Shield, requiredPermission: "app:roles.edit" },
  { to: "/sharing", labelId: "nav.sharing", icon: Handshake, requiredPermission: "app:settings.view" },
  { to: "/audit", labelId: "nav.audit", icon: ClipboardList, requiredPermission: "app:audit.view" },
  { to: "/settings", labelId: "nav.settings", icon: SettingsIcon, requiredPermission: "app:settings.view" },
];

const APP_VERSION = "2026.03.21.8";

interface SidebarProps {
  onNavigate?: () => void;
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const { can } = usePermissions();

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.requiredPermission || can(item.requiredPermission),
  );

  return (
    <div className="flex flex-col h-full">
      <nav className="flex flex-col gap-1 p-3 flex-1">
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
      <div className="px-4 py-3 border-t border-[var(--border)] text-xs text-[var(--text-muted)]">
        v{APP_VERSION}
      </div>
    </div>
  );
}
