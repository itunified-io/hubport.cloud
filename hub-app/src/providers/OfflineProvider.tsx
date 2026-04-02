/**
 * OfflineProvider — orchestrates device registration, key derivation,
 * Dexie DB initialisation, and initial sync after OIDC authentication.
 *
 * Lifecycle (runs once when token + sub become available):
 *  1. Register device (or re-register if already known)
 *  2. If device is revoked: wipe offline data, clear device identity, set error
 *  3. If active: fetch encryption salt, derive AES-256-GCM key from sub + salt
 *  4. Init Dexie DB with tenant scope and encryption key
 *  5. Request persistent storage from browser
 *  6. Trigger initial fullSync(token, deviceId)
 *  7. Mark provider as ready — children render with offline context
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/auth/useAuth";
import {
  registerDevice,
  getEncryptionSalt,
  deriveDeviceKey,
  clearDeviceIdentity,
  getCurrentDeviceUuid,
} from "@/lib/device-manager";
import { initOfflineDB, wipeOfflineData } from "@/lib/offline-db";
import { fullSync, requestPersistence } from "@/lib/sync-engine";

// ─── Context ─────────────────────────────────────────────────────

interface OfflineState {
  ready: boolean;
  deviceId: string | null;
  error: string | null;
}

const OfflineContext = createContext<OfflineState>({
  ready: false,
  deviceId: null,
  error: null,
});

export function useOffline(): OfflineState {
  return useContext(OfflineContext);
}

// ─── Provider ────────────────────────────────────────────────────

interface OfflineProviderProps {
  children: ReactNode;
}

/**
 * Resolve the tenant ID from:
 *  1. Runtime-injected __HUBPORT_CONFIG__.keycloakRealm
 *  2. VITE_KEYCLOAK_REALM build-time env var
 *  3. VITE_TENANT_ID build-time env var
 *  4. "default" fallback (should not happen in production)
 */
function resolveTenantId(): string {
  const runtimeConfig = (
    window as unknown as Record<string, unknown>
  ).__HUBPORT_CONFIG__ as { keycloakRealm?: string } | undefined;

  return (
    runtimeConfig?.keycloakRealm ||
    (import.meta.env.VITE_KEYCLOAK_REALM as string | undefined) ||
    (import.meta.env.VITE_TENANT_ID as string | undefined) ||
    "default"
  );
}

export function OfflineProvider({ children }: OfflineProviderProps) {
  const { user } = useAuth();

  const token = user?.access_token ?? null;
  const sub = user?.profile?.sub ?? null;

  const [state, setState] = useState<OfflineState>({
    ready: false,
    deviceId: null,
    error: null,
  });

  // Guard against double-run in React StrictMode
  const initStarted = useRef(false);

  useEffect(() => {
    // Only run when both token and sub are available
    if (!token || !sub) return;

    // Prevent re-running if already initialised or in progress
    if (initStarted.current) return;
    initStarted.current = true;

    let cancelled = false;

    async function init() {
      try {
        // 1. Register device (idempotent — backend upserts by deviceUuid)
        const device = await registerDevice(token!);

        if (cancelled) return;

        // 2. Handle revoked device
        if (device.status === "revoked") {
          await wipeOfflineData();
          clearDeviceIdentity();
          setState({
            ready: false,
            deviceId: null,
            error: "This device has been revoked. Contact your administrator.",
          });
          return;
        }

        // 3. Derive encryption key from OIDC sub + server-provided device salt
        const saltResult = await getEncryptionSalt(token!);
        if (cancelled) return;

        const key = await deriveDeviceKey(sub!, saltResult.encSalt);
        if (cancelled) return;

        // 4. Initialise the Dexie offline DB (tenant-scoped)
        const tenantId = resolveTenantId();
        initOfflineDB(tenantId, key);

        // 5. Request persistent storage (best-effort; failure is non-fatal)
        await requestPersistence().catch(() => false);
        if (cancelled) return;

        // 6. Retrieve the stable device UUID for sync calls
        const deviceId = getCurrentDeviceUuid();

        // 7. Initial sync — push any queued local changes, then pull remote state
        await fullSync(token!, deviceId);
        if (cancelled) return;

        setState({ ready: true, deviceId, error: null });
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Offline initialisation failed";
        console.error("[OfflineProvider]", message, err);
        setState({ ready: false, deviceId: null, error: message });
      }
    }

    void init();

    return () => {
      cancelled = true;
    };
  }, [token, sub]);

  return (
    <OfflineContext.Provider value={state}>{children}</OfflineContext.Provider>
  );
}
