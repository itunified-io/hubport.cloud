import { useIntl } from "react-intl";
import { NavLink, Outlet, Navigate, useLocation } from "react-router";

const TABS = [
  { path: "cleaning", labelId: "facilities.tab.cleaning" },
  { path: "grounds", labelId: "facilities.tab.grounds" },
  { path: "maintenance", labelId: "facilities.tab.maintenance" },
  { path: "preventive", labelId: "facilities.tab.preventive" },
];

export function FacilitiesPage() {
  const intl = useIntl();
  const location = useLocation();

  // Redirect /facilities to /facilities/cleaning
  if (location.pathname === "/facilities" || location.pathname === "/facilities/") {
    return <Navigate to="/facilities/cleaning" replace />;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--text)] mb-4">
        {intl.formatMessage({ id: "nav.facilities" })}
      </h1>

      <div className="flex border-b border-[var(--border)] mb-6">
        {TABS.map((tab) => (
          <NavLink
            key={tab.path}
            to={`/facilities/${tab.path}`}
            className={({ isActive }) =>
              `px-4 py-3 text-sm font-medium transition-colors ${
                isActive
                  ? "text-[var(--amber)] border-b-2 border-[var(--amber)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`
            }
          >
            {intl.formatMessage({ id: tab.labelId })}
          </NavLink>
        ))}
      </div>

      <Outlet />
    </div>
  );
}
