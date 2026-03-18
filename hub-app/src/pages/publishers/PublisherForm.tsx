import { FormattedMessage } from "react-intl";
import { useNavigate, useParams } from "react-router";
import { ArrowLeft } from "lucide-react";

export function PublisherForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate("/publishers")}
          className="p-2 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-xl font-semibold text-[var(--text)]">
          {isEdit ? (
            <FormattedMessage id="common.edit" />
          ) : (
            <FormattedMessage id="publishers.add" />
          )}
        </h1>
      </div>

      <form
        className="space-y-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] p-6"
        onSubmit={(e) => {
          e.preventDefault();
          navigate("/publishers");
        }}
      >
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-[var(--text-muted)]">
            <FormattedMessage id="publishers.name" />
          </label>
          <input
            type="text"
            className="w-full px-3 py-2 bg-[var(--bg-2)] border border-[var(--border-2)] rounded-[var(--radius-sm)] text-[var(--text)] text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--amber)] transition-colors"
            placeholder="Name"
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-[var(--text-muted)]">
            <FormattedMessage id="publishers.status" />
          </label>
          <select className="w-full px-3 py-2 bg-[var(--bg-2)] border border-[var(--border-2)] rounded-[var(--radius-sm)] text-[var(--text)] text-sm focus:outline-none focus:border-[var(--amber)] transition-colors">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="irregular">Irregular</option>
          </select>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            className="px-4 py-2 bg-[var(--amber)] text-black text-sm font-semibold rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer"
          >
            <FormattedMessage id="common.save" />
          </button>
          <button
            type="button"
            onClick={() => navigate("/publishers")}
            className="px-4 py-2 border border-[var(--border-2)] text-[var(--text-muted)] text-sm font-medium rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
          >
            <FormattedMessage id="common.cancel" />
          </button>
        </div>
      </form>
    </div>
  );
}
