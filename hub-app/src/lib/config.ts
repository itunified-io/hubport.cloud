/**
 * Runtime configuration — reads from window.__HUBPORT_CONFIG__ (injected by
 * docker-entrypoint.sh) with fallback to Vite build-time env vars.
 */

const cfg = (window as unknown as { __HUBPORT_CONFIG__?: Record<string, string> })
  .__HUBPORT_CONFIG__ ?? {};

export const API_BASE = cfg.API_URL ?? import.meta.env.VITE_API_URL ?? "";
export const KEYCLOAK_URL = cfg.KEYCLOAK_URL ?? import.meta.env.VITE_KEYCLOAK_URL ?? "";
export const KEYCLOAK_REALM = cfg.KEYCLOAK_REALM ?? import.meta.env.VITE_KEYCLOAK_REALM ?? "hubport";
export const KEYCLOAK_CLIENT_ID = cfg.KEYCLOAK_CLIENT_ID ?? import.meta.env.VITE_KEYCLOAK_CLIENT_ID ?? "hub-app";
