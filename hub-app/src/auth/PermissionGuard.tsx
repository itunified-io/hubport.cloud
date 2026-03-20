/**
 * Permission-based route guard — replaces RoleGuard.
 *
 * Usage:
 *   <PermissionGuard requires="app:publishers.view">
 *   <PermissionGuard requires={["a", "b"]} any>
 */

import { type ReactNode } from "react";
import { usePermissions } from "./PermissionProvider";
import { FormattedMessage } from "react-intl";

interface PermissionGuardProps {
  requires: string | string[];
  any?: boolean;
  children: ReactNode;
  fallback?: ReactNode;
}

export function PermissionGuard({
  requires,
  any = false,
  children,
  fallback,
}: PermissionGuardProps) {
  const { can, canAny, isLoaded } = usePermissions();

  // While permissions are loading, show nothing (avoid flash)
  if (!isLoaded) return null;

  const perms = Array.isArray(requires) ? requires : [requires];

  const hasAccess = any
    ? canAny(...perms)
    : perms.every(can);

  if (!hasAccess) {
    return (
      fallback ?? (
        <div className="flex items-center justify-center h-full">
          <div className="text-center p-8">
            <p className="text-[var(--text-muted)] text-sm">
              <FormattedMessage
                id="auth.no_permission"
                defaultMessage="You do not have permission to view this page."
              />
            </p>
          </div>
        </div>
      )
    );
  }

  return <>{children}</>;
}
