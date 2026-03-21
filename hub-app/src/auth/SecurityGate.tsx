/**
 * SecurityGate — blocks app until security setup is complete.
 * ADR-0077: Password changed + passkey OR TOTP required.
 *
 * Wraps the entire app after AuthProvider.
 * If setup incomplete → renders SecurityWizard (full-screen, no nav).
 */
import { useState, useEffect, type ReactNode } from "react";
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

export function SecurityGate({ children }: Props): ReactNode {
  const { isAuthenticated, user } = useAuth();
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    } catch (err) {
      console.warn("SecurityGate: status check failed:", err);
      setError((err as Error).message);
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

  // Error fetching — allow through (graceful degradation)
  if (error) return children;

  // Setup complete — render app normally
  if (status?.setupComplete) return children;

  // Setup incomplete — show wizard
  return <SecurityWizard status={status!} onComplete={fetchStatus} />;
}
