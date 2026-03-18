import { useAuth as useOidcAuth } from "react-oidc-context";

export type AppRole = "admin" | "elder" | "publisher" | "viewer";

interface RealmAccess {
  roles?: string[];
}

interface KeycloakToken {
  realm_access?: RealmAccess;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
}

function parseRoles(profile: KeycloakToken | undefined): AppRole[] {
  const keycloakRoles = profile?.realm_access?.roles ?? [];
  const appRoles: AppRole[] = [];

  for (const role of keycloakRoles) {
    if (
      role === "admin" ||
      role === "elder" ||
      role === "publisher" ||
      role === "viewer"
    ) {
      appRoles.push(role);
    }
  }

  return appRoles;
}

export function useAuth() {
  const auth = useOidcAuth();

  const tokenPayload = auth.user?.profile as KeycloakToken | undefined;
  const roles = parseRoles(tokenPayload);

  const isAdmin = roles.includes("admin");
  const isElder = roles.includes("elder") || isAdmin;
  const isPublisher = roles.includes("publisher") || isElder;
  const isViewer = roles.includes("viewer") || isPublisher;

  const displayName =
    tokenPayload?.given_name ??
    tokenPayload?.preferred_username ??
    auth.user?.profile?.name ??
    "User";

  return {
    user: auth.user,
    isAuthenticated: auth.isAuthenticated,
    isLoading: auth.isLoading,
    error: auth.error,
    roles,
    isAdmin,
    isElder,
    isPublisher,
    isViewer,
    displayName,
    signIn: () => auth.signinRedirect(),
    signOut: () => auth.signoutRedirect(),
  };
}
