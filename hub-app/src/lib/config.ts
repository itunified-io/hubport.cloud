/**
 * Runtime-first configuration.
 * docker-entrypoint.sh injects window.__HUBPORT_CONFIG__; build-time VITE_ vars are fallback.
 */

interface HubportConfig {
  keycloakUrl?: string;
  keycloakRealm?: string;
  keycloakClientId?: string;
  apiUrl?: string;
}

const runtimeConfig = (window as unknown as Record<string, unknown>)
  .__HUBPORT_CONFIG__ as HubportConfig | undefined;

/** API base URL — reads runtime config first, then VITE_API_URL, then empty (same-origin). */
export function getApiUrl(): string {
  return runtimeConfig?.apiUrl || (import.meta.env.VITE_API_URL as string) || "";
}
