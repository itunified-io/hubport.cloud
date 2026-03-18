import { FormattedMessage } from "react-intl";
import { useNavigate } from "react-router";
import { Plus, Users } from "lucide-react";

export function PublisherList() {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-[var(--text)]">
          <FormattedMessage id="publishers.title" />
        </h1>
        <button
          onClick={() => navigate("/publishers/new")}
          className="flex items-center gap-2 px-4 py-2 bg-[var(--amber)] text-black text-sm font-semibold rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer"
        >
          <Plus size={16} />
          <FormattedMessage id="publishers.add" />
        </button>
      </div>

      {/* Empty state */}
      <div className="flex flex-col items-center justify-center py-16 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
        <Users size={40} className="text-[var(--text-muted)] mb-3" strokeWidth={1.2} />
        <p className="text-sm text-[var(--text-muted)]">
          <FormattedMessage id="publishers.empty" />
        </p>
      </div>
    </div>
  );
}
