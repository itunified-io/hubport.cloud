import { type ReactNode, createContext, useContext, useState, useEffect, useCallback } from "react";
import { useAuth } from "./useAuth";

interface PermissionData {
  effectivePermissions: string[];
  denyRules: string[];
  pageVisibility: Record<string, boolean>;
  privacyAccepted: boolean;
  congregationRole: string | null;
  appRoles: { name: string; scope: string }[];
}

interface PermissionContextValue extends PermissionData {
  can: (permission: string) => boolean;
  loading: boolean;
  refresh: () => void;
}

const defaultValue: PermissionContextValue = {
  effectivePermissions: [],
  denyRules: [],
  pageVisibility: {},
  privacyAccepted: true,
  congregationRole: null,
  appRoles: [],
  can: () => false,
  loading: true,
  refresh: () => {},
};

const PermissionCtx = createContext<PermissionContextValue>(defaultValue);

export function usePermissions(): PermissionContextValue {
  return useContext(PermissionCtx);
}

export function PermissionProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  const [data, setData] = useState<PermissionData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPermissions = useCallback(async () => {
    if (!isAuthenticated || !user?.access_token) {
      setLoading(false);
      return;
    }

    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const res = await fetch(`${apiUrl}/permissions/me`, {
        headers: { Authorization: `Bearer ${user.access_token}` },
      });

      if (res.ok) {
        const result = await res.json() as PermissionData;
        setData(result);
      }
    } catch {
      // Silently fail — permissions will be empty (deny-all)
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, user?.access_token]);

  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  const can = useCallback(
    (permission: string): boolean => {
      if (!data) return false;
      if (data.effectivePermissions.includes("*")) return true;
      if (data.effectivePermissions.includes(permission)) return true;
      // Prefix wildcard check
      return data.effectivePermissions.some(
        (p) => p.endsWith(".*") && permission.startsWith(p.slice(0, -1)),
      );
    },
    [data],
  );

  const value: PermissionContextValue = {
    effectivePermissions: data?.effectivePermissions ?? [],
    denyRules: data?.denyRules ?? [],
    pageVisibility: data?.pageVisibility ?? {},
    privacyAccepted: data?.privacyAccepted ?? true,
    congregationRole: data?.congregationRole ?? null,
    appRoles: data?.appRoles ?? [],
    can,
    loading,
    refresh: fetchPermissions,
  };

  return (
    <PermissionCtx.Provider value={value}>
      {children}
    </PermissionCtx.Provider>
  );
}
