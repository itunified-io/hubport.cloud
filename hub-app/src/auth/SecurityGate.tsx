/**
 * SecurityGate — blocks app until security setup is complete.
 * ADR-0077: Password changed + passkey OR TOTP required.
 * ADR-0081: Fail-closed — errors block access, never pass through.
 *
 * Wraps the entire app after AuthProvider.
 * If setup incomplete → renders SecurityWizard (full-screen, no nav).
 * If status check fails → shows error UI with retry (max 3 attempts).
 */
import { useState, useEffect, useRef, type ReactNode } from "react";
import { useAuth } from "@/auth/useAuth";
import { getApiUrl } from "@/lib/config";
import { SecurityWizard } from "./SecurityWizard";

interface SecurityStatus {
  passwordChanged: boolean;
  passkeyRegistered: boolean;
  totpConfigured: boolean;
  setupComplete: boolean;
}

interface Props {
  children: ReactNode;
}

const MAX_RETRIES = 3;

export function SecurityGate({ children }: Props): ReactNode {
  const { isAuthenticated, user } = useAuth();
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const retryCount = useRef(0);

  const fetchStatus = async () => {
    if (!user?.access_token) return;
    try {
      setLoading(true);
      const res = await fetch(`${getApiUrl()}/security/status`, {
        headers: { Authorization: `Bearer ${user.access_token}` },
      });
      if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
      const data = (await res.json()) as SecurityStatus;
      setStatus(data);
      setError(null);
      retryCount.current = 0;
    } catch (err) {
      console.warn("SecurityGate: status check failed:", err);
      setError((err as Error).message);
      retryCount.current++;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated && user?.access_token) {
      fetchStatus();
    }
  }, [isAuthenticated, user?.access_token]);

  // Not authenticated — let AuthProvider handle
  if (!isAuthenticated) return children;

  // Still loading
  if (loading) {
    return (
      <div className="min-h-dvh bg-[var(--bg)] flex items-center justify-center">
        <div className="text-[var(--text-muted)]">Checking security status...</div>
      </div>
    );
  }

  // Error fetching — fail closed (ADR-0081), show error UI with retry
  if (error) {
    const exhausted = retryCount.current >= MAX_RETRIES;
    return (
      <div className="min-h-dvh bg-[var(--bg)] flex items-center justify-center">
        <div className="max-w-md text-center space-y-4 p-6">
          <div className="text-[var(--text-muted)] text-lg font-medium">
            Security check unavailable
          </div>
          <p className="text-[var(--text-muted)] text-sm">
            {exhausted
              ? "Unable to verify your security status after multiple attempts. Please contact your administrator."
              : "Could not verify your security status. Please try again."}
          </p>
          {!exhausted && (
            <button
              onClick={() => fetchStatus()}
              className="px-4 py-2 rounded-lg bg-[var(--accent)] text-[var(--bg)] font-medium hover:opacity-90 transition-opacity"
            >
              Retry ({MAX_RETRIES - retryCount.current} remaining)
            </button>
          )}
        </div>
      </div>
    );
  }

  // Setup complete — render app normally
  if (status?.setupComplete) return children;

  // Setup incomplete — show wizard
  return <SecurityWizard status={status!} onComplete={fetchStatus} />;
}
