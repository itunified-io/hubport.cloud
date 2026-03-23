import { useState } from "react";
import { NavLink, useLocation } from "react-router";
import { FormattedMessage } from "react-intl";
import {
  LayoutDashboard,
  Users,
  Map,
  Calendar,
  Handshake,
  Settings as SettingsIcon,
  ClipboardList,
  Sparkles,
  BookOpen,
  CalendarClock,
  Mic,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { usePermissions } from "@/auth/PermissionProvider";

interface NavItem {
  to: string;
  labelId: string;
  icon: React.ElementType;
  /** Permission required to see this nav item. Null = visible to all authenticated. */
  requiredPermission: string | null;
  /** Sub-items shown when parent is expanded */
  children?: NavItem[];
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", labelId: "nav.dashboard", icon: LayoutDashboard, requiredPermission: null },
  { to: "/publishers", labelId: "nav.publishers", icon: Users, requiredPermission: "app:publishers.view" },
  { to: "/territories", labelId: "nav.territories", icon: Map, requiredPermission: "app:territories.view" },
  {
    to: "/meetings", labelId: "nav.meetings", icon: Calendar, requiredPermission: "app:meetings.view",
    children: [
      { to: "/meetings/planner", labelId: "nav.meetings.planner", icon: BookOpen, requiredPermission: "app:meeting_assignments.view" },
      { to: "/meetings/weekend", labelId: "nav.meetings.weekend", icon: CalendarClock, requiredPermission: "app:meeting_assignments.view" },
      { to: "/meetings/public-talks", labelId: "nav.meetings.publicTalks", icon: Mic, requiredPermission: "app:public_talks.view" },
    ],
  },
  { to: "/cleaning", labelId: "nav.cleaning", icon: Sparkles, requiredPermission: "app:cleaning.view" },
  { to: "/sharing", labelId: "nav.sharing", icon: Handshake, requiredPermission: "app:sharing.view" },
  { to: "/audit", labelId: "nav.audit", icon: ClipboardList, requiredPermission: "app:audit.view" },
  { to: "/settings", labelId: "nav.settings", icon: SettingsIcon, requiredPermission: "app:settings.view" },
];

const APP_VERSION = "2026.03.23.8";

interface SidebarProps {
  onNavigate?: () => void;
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const { can } = usePermissions();
  const location = useLocation();

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.requiredPermission || can(item.requiredPermission),
  );

  return (
    <div className="flex flex-col h-full">
      <nav className="flex flex-col gap-1 p-3 flex-1">
        {visibleItems.map((item) => (
          <SidebarItem
            key={item.to}
            item={item}
            can={can}
            currentPath={location.pathname}
            onNavigate={onNavigate}
          />
        ))}
      </nav>
      <div className="px-4 py-3 border-t border-[var(--border)] text-xs text-[var(--text-muted)]">
        v{APP_VERSION}
      </div>
    </div>
  );
}

function SidebarItem({
  item,
  can,
  currentPath,
  onNavigate,
}: {
  item: NavItem;
  can: (p: string) => boolean;
  currentPath: string;
  onNavigate?: () => void;
}) {
  const hasChildren = item.children && item.children.length > 0;
  const visibleChildren = item.children?.filter(
    (child) => !child.requiredPermission || can(child.requiredPermission),
  );
  const isChildActive = visibleChildren?.some((c) => currentPath.startsWith(c.to));
  const [expanded, setExpanded] = useState(isChildActive ?? false);

  if (!hasChildren || !visibleChildren?.length) {
    return (
      <NavLink
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
    );
  }

  return (
    <div>
      <div className="flex items-center">
        <NavLink
          to={item.to}
          end
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex-1 flex items-center gap-3 px-3 py-2.5 rounded-l-[var(--radius-sm)] text-sm font-medium transition-colors ${
              isActive
                ? "bg-[var(--glass-2)] text-[var(--amber)]"
                : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)]"
            }`
          }
        >
          <item.icon size={18} strokeWidth={1.8} />
          <FormattedMessage id={item.labelId} />
        </NavLink>
        <button
          onClick={() => setExpanded(!expanded)}
          className="px-2 py-2.5 rounded-r-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>
      {expanded && (
        <div className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-[var(--border)] pl-2">
          {visibleChildren.map((child) => (
            <NavLink
              key={child.to}
              to={child.to}
              onClick={onNavigate}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius-sm)] text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-[var(--glass-2)] text-[var(--amber)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)]"
                }`
              }
            >
              <child.icon size={15} strokeWidth={1.8} />
              <FormattedMessage id={child.labelId} />
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}
