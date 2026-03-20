import { type ReactNode } from "react";
import { usePermissions } from "./PermissionProvider";

interface PermissionGuardProps {
  requires: string | string[];
  /** If true, any of the listed permissions grants access. Default: false (all required). */
  any?: boolean;
  children: ReactNode;
  fallback?: ReactNode;
}

export function PermissionGuard({
  requires,
  any: anyMode = false,
  children,
  fallback,
}: PermissionGuardProps) {
  const { can, loading } = usePermissions();

  if (loading) return null;

  const perms = Array.isArray(requires) ? requires : [requires];
  const hasAccess = anyMode
    ? perms.some((p) => can(p))
    : perms.every((p) => can(p));

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
