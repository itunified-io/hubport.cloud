import { useState, useEffect } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { ArrowLeft, Send } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { usePermissions } from "@/auth/PermissionProvider";
import { getApiUrl } from "@/lib/config";

interface Photo { id: string; data: string; mimeType: string; caption: string | null; }
interface Comment { id: string; text: string; createdAt: string; author: { id: string; firstName: string; lastName: string }; }
interface IssueDetail {
  id: string; title: string; description: string; category: string; priority: string; status: string;
  location: string | null; reporter: { id: string; firstName: string; lastName: string };
  assignee: { id: string; firstName: string; lastName: string } | null;
  createdAt: string; resolvedAt: string | null; closedAt: string | null;
  photos: Photo[]; comments: Comment[];
}

interface Props { issueId: string; onBack: () => void; }

const STATUS_TRANSITIONS: Record<string, string[]> = {
  reported: ["under_review", "rejected"],
  under_review: ["approved", "forwarded_to_ldc", "rejected"],
  approved: ["in_progress", "forwarded_to_ldc"],
  forwarded_to_ldc: ["in_progress", "resolved"],
  in_progress: ["resolved"],
  resolved: ["closed", "in_progress"],
  closed: [],
  rejected: [],
};

export function MaintenanceDetail({ issueId, onBack }: Props) {
  const { user } = useAuth();
  const { can } = usePermissions();
  const intl = useIntl();
  const apiUrl = getApiUrl();
  const headers = { Authorization: `Bearer ${user?.access_token}`, "Content-Type": "application/json" };
  const canManage = can("manage:facilities.maintenance");

  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [commentText, setCommentText] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchIssue = async () => {
    const res = await fetch(`${apiUrl}/facilities/maintenance/${issueId}`, { headers });
    if (res.ok) setIssue(await res.json() as IssueDetail);
    setLoading(false);
  };

  useEffect(() => { fetchIssue(); }, [issueId]);

  const changeStatus = async (newStatus: string) => {
    await fetch(`${apiUrl}/facilities/maintenance/${issueId}`, {
      method: "PUT", headers, body: JSON.stringify({ status: newStatus }),
    });
    fetchIssue();
  };

  const addComment = async () => {
    if (!commentText.trim()) return;
    await fetch(`${apiUrl}/facilities/maintenance/${issueId}/comments`, {
      method: "POST", headers, body: JSON.stringify({ text: commentText }),
    });
    setCommentText("");
    fetchIssue();
  };

  if (loading || !issue) {
    return <div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-2 border-[var(--amber)] border-t-transparent rounded-full animate-spin" /></div>;
  }

  const validTransitions = STATUS_TRANSITIONS[issue.status] ?? [];

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"><ArrowLeft size={14} /> Back</button>

      {/* Header */}
      <div className="p-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] space-y-3">
        <h2 className="text-lg font-semibold text-[var(--text)]">{issue.title}</h2>
        <div className="flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
          <span>{intl.formatMessage({ id: `facilities.category.${issue.category}` })}</span>
          <span>·</span>
          <span>{intl.formatMessage({ id: `facilities.priority.${issue.priority}` })}</span>
          <span>·</span>
          <span>{intl.formatMessage({ id: `facilities.status.${issue.status}` })}</span>
          {issue.location && <><span>·</span><span>{issue.location}</span></>}
        </div>
        <p className="text-sm text-[var(--text)]">{issue.description}</p>
        <div className="text-xs text-[var(--text-muted)]">
          Reporter: {issue.reporter.firstName} {issue.reporter.lastName}
          {issue.assignee && ` · Assigned: ${issue.assignee.firstName} ${issue.assignee.lastName}`}
        </div>

        {/* Status Actions */}
        {canManage && validTransitions.length > 0 && (
          <div className="flex gap-2 pt-2 border-t border-[var(--border)]">
            {validTransitions.map((s) => (
              <button key={s} onClick={() => changeStatus(s)} className="px-3 py-1.5 text-xs border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--glass)] cursor-pointer">
                → {intl.formatMessage({ id: `facilities.status.${s}` })}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Photos */}
      {issue.photos.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {issue.photos.map((p) => (
            <div key={p.id} className="border border-[var(--border)] rounded-[var(--radius-sm)] overflow-hidden bg-[var(--bg-1)]">
              <img src={`data:${p.mimeType};base64,${p.data}`} alt={p.caption ?? ""} className="w-full h-40 object-cover" />
              {p.caption && <p className="px-2 py-1 text-xs text-[var(--text-muted)]">{p.caption}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Comments */}
      <div className="p-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] space-y-3">
        <h3 className="text-sm font-medium text-[var(--text)]">Comments ({issue.comments.length})</h3>
        {issue.comments.map((c) => (
          <div key={c.id} className="p-3 border border-[var(--border)] rounded-[var(--radius-sm)] bg-[var(--bg)]">
            <div className="text-xs text-[var(--text-muted)] mb-1">{c.author.firstName} {c.author.lastName} · {new Date(c.createdAt).toLocaleDateString()}</div>
            <p className="text-sm text-[var(--text)]">{c.text}</p>
          </div>
        ))}
        <div className="flex gap-2">
          <input value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Add a comment..." onKeyDown={(e) => e.key === "Enter" && addComment()} className="flex-1 px-3 py-2 text-sm bg-[var(--input)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]" />
          <button onClick={addComment} disabled={!commentText.trim()} className="px-3 py-2 bg-[var(--amber)] text-black rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] disabled:opacity-50 cursor-pointer"><Send size={14} /></button>
        </div>
      </div>
    </div>
  );
}
