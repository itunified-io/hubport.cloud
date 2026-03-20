import { type ReactNode } from "react";
import { AuthProvider as OidcAuthProvider } from "react-oidc-context";
import { type WebStorageStateStore } from "oidc-client-ts";

// Runtime config (injected by docker-entrypoint.sh) takes precedence over build-time VITE_ vars
const runtimeConfig = (window as unknown as Record<string, unknown>).__HUBPORT_CONFIG__ as
  | { keycloakUrl?: string; keycloakRealm?: string; keycloakClientId?: string }
  | undefined;

const keycloakUrl = runtimeConfig?.keycloakUrl || (import.meta.env.VITE_KEYCLOAK_URL as string);
const realm = runtimeConfig?.keycloakRealm || (import.meta.env.VITE_KEYCLOAK_REALM as string);
const clientId = runtimeConfig?.keycloakClientId || (import.meta.env.VITE_KEYCLOAK_CLIENT_ID as string);

const oidcConfig = {
  authority: `${keycloakUrl}/realms/${realm}`,
  client_id: clientId,
  redirect_uri: window.location.origin,
  post_logout_redirect_uri: window.location.origin,
  scope: "openid profile email",
  automaticSilentRenew: true,
  loadUserInfo: true,
  userStore: undefined as WebStorageStateStore | undefined,
  onSigninCallback: () => {
    window.history.replaceState({}, document.title, window.location.pathname);
  },
};

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  return <OidcAuthProvider {...oidcConfig}>{children}</OidcAuthProvider>;
}
