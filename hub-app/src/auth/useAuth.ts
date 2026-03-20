import { useAuth as useOidcAuth } from "react-oidc-context";

export type AppRole = "admin" | "elder" | "publisher" | "viewer";

interface RealmAccess {
  roles?: string[];
}

interface TokenPayload {
  realm_access?: RealmAccess;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
}

function decodeJwtPayload(token: string): TokenPayload | undefined {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;
    const payload = atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(payload) as TokenPayload;
  } catch {
    return undefined;
  }
}

function parseRoles(payload: TokenPayload | undefined): AppRole[] {
  const keycloakRoles = payload?.realm_access?.roles ?? [];
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

  // Keycloak puts realm_access in the access token, not the ID token.
  // Decode the access token JWT to get roles.
  const accessTokenPayload = auth.user?.access_token
    ? decodeJwtPayload(auth.user.access_token)
    : undefined;

  // Fallback to ID token profile if access token decoding fails
  const idTokenPayload = auth.user?.profile as TokenPayload | undefined;
  const tokenPayload = accessTokenPayload ?? idTokenPayload;

  const roles = parseRoles(tokenPayload);

  const isAdmin = roles.includes("admin");
  const isElder = roles.includes("elder") || isAdmin;
  const isPublisher = roles.includes("publisher") || isElder;
  const isViewer = roles.includes("viewer") || isPublisher;

  const displayName =
    idTokenPayload?.given_name ??
    idTokenPayload?.preferred_username ??
    accessTokenPayload?.preferred_username ??
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
    email: idTokenPayload?.email ?? accessTokenPayload?.email,
    signIn: () => auth.signinRedirect(),
    signOut: () => auth.signoutRedirect(),
  };
}
