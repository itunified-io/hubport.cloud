import { NavLink } from "react-router";
import { FormattedMessage } from "react-intl";
import {
  LayoutDashboard,
  Users,
  Map,
  Calendar,
  Handshake,
  Settings as SettingsIcon,
  ScrollText,
} from "lucide-react";
import { usePermissions } from "@/auth/PermissionProvider";

interface NavItem {
  to: string;
  labelId: string;
  icon: React.ElementType;
  requiredPermission?: string | string[];
  any?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", labelId: "nav.dashboard", icon: LayoutDashboard },
  {
    to: "/publishers",
    labelId: "nav.publishers",
    icon: Users,
    requiredPermission: ["app:publishers.view", "app:publishers.view_minimal"],
    any: true,
  },
  {
    to: "/territories",
    labelId: "nav.territories",
    icon: Map,
    requiredPermission: "app:territories.view",
  },
  {
    to: "/meetings",
    labelId: "nav.meetings",
    icon: Calendar,
    requiredPermission: "app:meetings.view",
  },
  {
    to: "/sharing",
    labelId: "nav.sharing",
    icon: Handshake,
    requiredPermission: "app:settings.view",
  },
  {
    to: "/audit",
    labelId: "nav.audit",
    icon: ScrollText,
    requiredPermission: "app:audit.view",
  },
  {
    to: "/settings",
    labelId: "nav.settings",
    icon: SettingsIcon,
    requiredPermission: "app:settings.view",
  },
];

interface SidebarProps {
  onNavigate?: () => void;
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const { can, canAny, isLoaded } = usePermissions();

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!item.requiredPermission) return true;
    if (!isLoaded) return false;

    const perms = Array.isArray(item.requiredPermission)
      ? item.requiredPermission
      : [item.requiredPermission];

    return item.any ? canAny(...perms) : perms.every(can);
  });

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
