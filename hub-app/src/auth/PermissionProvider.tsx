/**
 * Permission context — fetches effective permissions from API on login.
 *
 * Provides usePermissions() hook for permission-based UI gating.
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./useAuth";

interface PermissionState {
  effectivePermissions: string[];
  denyRules: string[];
  appRoles: Array<{ roleId: string; name: string; scope: string }>;
  pageVisibility: Record<string, boolean>;
  publisherId: string | null;
  keycloakRole: string;
  privacyAccepted: boolean;
  isLoaded: boolean;
}

interface PermissionContextValue extends PermissionState {
  can: (permission: string) => boolean;
  canAny: (...permissions: string[]) => boolean;
  reload: () => void;
}

const defaultState: PermissionState = {
  effectivePermissions: [],
  denyRules: [],
  appRoles: [],
  pageVisibility: {},
  publisherId: null,
  keycloakRole: "viewer",
  privacyAccepted: false,
  isLoaded: false,
};

const PermissionContext = createContext<PermissionContextValue>({
  ...defaultState,
  can: () => false,
  canAny: () => false,
  reload: () => {},
});

import { API_BASE } from "@/lib/config";

export function PermissionProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  const [state, setState] = useState<PermissionState>(defaultState);

  const fetchPermissions = async () => {
    if (!isAuthenticated || !user?.access_token) return;

    try {
      const res = await fetch(`${API_BASE}/permissions/me`, {
        headers: { Authorization: `Bearer ${user.access_token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setState({
        effectivePermissions: data.effectivePermissions ?? [],
        denyRules: data.denyRules ?? [],
        appRoles: data.appRoles ?? [],
        pageVisibility: data.pageVisibility ?? {},
        publisherId: data.publisherId ?? null,
        keycloakRole: data.keycloakRole ?? "viewer",
        privacyAccepted: data.privacyAccepted ?? false,
        isLoaded: true,
      });
    } catch {
      // Fallback: use Keycloak roles from token
      setState((prev) => ({ ...prev, isLoaded: true }));
    }
  };

  useEffect(() => {
    fetchPermissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user?.access_token]);

  const can = (permission: string): boolean => {
    if (state.effectivePermissions.includes("*")) return true;
    return state.effectivePermissions.some(
      (p) =>
        p === permission ||
        (p.endsWith(".*") && permission.startsWith(p.slice(0, -1))),
    );
  };

  const canAny = (...permissions: string[]): boolean =>
    permissions.some(can);

  return (
    <PermissionContext.Provider
      value={{ ...state, can, canAny, reload: fetchPermissions }}
    >
      {children}
    </PermissionContext.Provider>
  );
}

export function usePermissions() {
  return useContext(PermissionContext);
}
