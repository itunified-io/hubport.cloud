import { type ReactNode } from "react";
import { useAuth, type AppRole } from "./useAuth";

interface RoleGuardProps {
  requiredRole: AppRole;
  children: ReactNode;
  fallback?: ReactNode;
}

const ROLE_HIERARCHY: Record<AppRole, number> = {
  viewer: 0,
  publisher: 1,
  elder: 2,
  admin: 3,
};

export function RoleGuard({ requiredRole, children, fallback }: RoleGuardProps) {
  const { roles } = useAuth();

  const requiredLevel = ROLE_HIERARCHY[requiredRole];
  const hasAccess = roles.some(
    (role) => ROLE_HIERARCHY[role] >= requiredLevel,
  );

  if (!hasAccess) {
    return fallback ?? (
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-8">
          <p className="text-[var(--text-muted)] text-sm">
            You do not have permission to view this page.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
