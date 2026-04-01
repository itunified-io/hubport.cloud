import { useEffect, useState } from "react";
import { FormattedMessage } from "react-intl";
import { RotateCcw } from "lucide-react";
import { getVersions, restoreVersion, type BoundaryVersion, type AutoFixResult } from "@/lib/territory-api";

interface VersionHistoryProps {
  territoryId: string;
  token: string | null;
  canEdit: boolean;
  onRestore: (result: AutoFixResult) => void;
}

export function VersionHistory({ territoryId, token, canEdit, onRestore }: VersionHistoryProps) {
  const [versions, setVersions] = useState<BoundaryVersion[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) return;
    getVersions(token, territoryId).then(setVersions).catch(console.error);
  }, [token, territoryId]);

  if (versions.length === 0) return null;

  const handleRestore = async (versionId: string) => {
    if (!token) return;
    setLoading(true);
    try {
      const result = await restoreVersion(token, territoryId, versionId);
      onRestore(result);
    } catch (err) {
      console.error("Restore preview failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const changeTypeLabel: Record<string, string> = {
    creation: "Created",
    manual_edit: "Manual edit",
    auto_clip: "Auto-clip",
    import: "KML import",
    restore: "Restored",
  };

  return (
    <div className="mt-2 px-2">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">
        <FormattedMessage id="territories.versions.title" defaultMessage="Boundary History" />
      </div>
      <div className="space-y-1 max-h-32 overflow-y-auto">
        {versions.map((v, i) => (
          <div
            key={v.id}
            className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${
              i === 0
                ? "bg-purple-500/10 border border-purple-500/20"
                : "bg-[var(--bg-1)] border border-[var(--border)]"
            }`}
          >
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
              i === 0 ? "bg-purple-500 text-white" : "bg-[var(--bg-3)] text-[var(--text-muted)]"
            }`}>
              v{v.version}
            </span>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{changeTypeLabel[v.changeType] || v.changeType}</div>
              {v.changeSummary && (
                <div className="text-[10px] text-[var(--text-muted)] truncate">{v.changeSummary}</div>
              )}
            </div>
            {i === 0 ? (
              <span className="text-[10px] text-purple-400">current</span>
            ) : canEdit ? (
              <button
                onClick={() => handleRestore(v.id)}
                disabled={loading}
                className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text)] flex items-center gap-1"
              >
                <RotateCcw size={10} />
                restore
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
