import { type ReactNode } from "react";
import { AuthProvider as OidcAuthProvider } from "react-oidc-context";
import { type WebStorageStateStore } from "oidc-client-ts";

const keycloakUrl = import.meta.env.VITE_KEYCLOAK_URL as string;
const realm = import.meta.env.VITE_KEYCLOAK_REALM as string;
const clientId = import.meta.env.VITE_KEYCLOAK_CLIENT_ID as string;

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
