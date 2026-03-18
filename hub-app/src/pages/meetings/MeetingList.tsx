import { FormattedMessage } from "react-intl";
import { useNavigate } from "react-router";
import { Plus, Calendar } from "lucide-react";
import { useAuth } from "@/auth/useAuth";

export function MeetingList() {
  const navigate = useNavigate();
  const { isElder } = useAuth();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--text)]">
          <FormattedMessage id="meetings.title" />
        </h1>
        {isElder && (
          <button
            onClick={() => navigate("/meetings/new")}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--amber)] text-black text-sm font-semibold rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer"
          >
            <Plus size={16} />
            <FormattedMessage id="meetings.add" />
          </button>
        )}
      </div>

      {/* Empty state */}
      <div className="flex flex-col items-center justify-center py-16 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
        <Calendar size={40} className="text-[var(--text-muted)] mb-3" strokeWidth={1.2} />
        <p className="text-sm text-[var(--text-muted)]">
          <FormattedMessage id="meetings.empty" />
        </p>
      </div>
    </div>
  );
}
