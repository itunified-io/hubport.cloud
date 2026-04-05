import { useState, useEffect } from "react";
import { FormattedMessage } from "react-intl";
import { Leaf, Users } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { usePermissions } from "@/auth/PermissionProvider";
import { getApiUrl } from "@/lib/config";

interface GardenDuty {
  id: string;
  name: string;
  type: string;
  members: {
    id: string;
    publisher: { id: string; firstName: string; lastName: string; displayName: string | null };
  }[];
}

export function GroundsTab() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const apiUrl = getApiUrl();
  const headers = { Authorization: `Bearer ${user?.access_token}`, "Content-Type": "application/json" };
  const canManage = can("manage:facilities.grounds");

  const [duties, setDuties] = useState<GardenDuty[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDuties = async () => {
    try {
      const res = await fetch(`${apiUrl}/facilities/grounds`, { headers });
      if (res.ok) setDuties(await res.json() as GardenDuty[]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDuties(); }, [user?.access_token]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-[var(--amber)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="p-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-[var(--text)] flex items-center gap-2">
            <Leaf size={14} className="text-[var(--green)]" />
            <FormattedMessage id="facilities.grounds.title" />
          </h2>
          {canManage && (
            <button className="px-3 py-1.5 text-sm text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer">
              <FormattedMessage id="facilities.grounds.add" />
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {duties.map((d) => (
            <div key={d.id} className="p-3 border border-[var(--border)] rounded-[var(--radius-sm)] bg-[var(--bg)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-[var(--text)]">{d.name}</span>
                <span className="text-[10px] text-[var(--text-muted)] bg-[var(--glass)] px-1.5 py-0.5 rounded">{d.type}</span>
              </div>
              {d.members.length > 0 ? (
                <div className="space-y-1">
                  {d.members.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                      <Users size={10} />
                      {m.publisher.displayName ?? `${m.publisher.firstName} ${m.publisher.lastName}`}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[var(--text-muted)]">
                  <FormattedMessage id="facilities.grounds.noMembers" />
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
