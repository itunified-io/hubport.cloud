import { type ReactNode } from "react";
import { AuthProvider as OidcAuthProvider } from "react-oidc-context";
import { type WebStorageStateStore } from "oidc-client-ts";
import { KEYCLOAK_URL, KEYCLOAK_REALM, KEYCLOAK_CLIENT_ID } from "@/lib/config";

const oidcConfig = {
  authority: `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`,
  client_id: KEYCLOAK_CLIENT_ID,
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
