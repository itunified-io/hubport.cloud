import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { X } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { getApiUrl } from "@/lib/config";

interface Props { onClose: () => void; onCreated: () => void; }

export function PreventiveForm({ onClose, onCreated }: Props) {
  const { user } = useAuth();
  const intl = useIntl();
  const apiUrl = getApiUrl();
  const headers = { Authorization: `Bearer ${user?.access_token}`, "Content-Type": "application/json" };

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("other");
  const [frequency, setFrequency] = useState("3m");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!name) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${apiUrl}/facilities/preventive`, {
        method: "POST", headers, body: JSON.stringify({ name, description: description || undefined, category, frequency }),
      });
      if (res.ok) onCreated();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius)] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[var(--text)]"><FormattedMessage id="facilities.preventive.create" /></h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"><X size={18} /></button>
        </div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Task name" className="w-full px-3 py-2 text-sm bg-[var(--input)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]" />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" rows={2} className="w-full px-3 py-2 text-sm bg-[var(--input)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]" />
        <div className="grid grid-cols-2 gap-3">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="px-3 py-2 text-sm bg-[var(--input)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]">
            {["electrical", "plumbing", "hvac", "structural", "safety", "grounds", "interior", "audio_video", "other"].map((c) => (
              <option key={c} value={c}>{intl.formatMessage({ id: `facilities.category.${c}` })}</option>
            ))}
          </select>
          <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className="px-3 py-2 text-sm bg-[var(--input)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]">
            {["1w", "2w", "1m", "3m", "6m", "1y"].map((f) => (
              <option key={f} value={f}>{intl.formatMessage({ id: `facilities.frequency.${f}` })}</option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] cursor-pointer">Cancel</button>
          <button onClick={submit} disabled={!name || submitting} className="px-4 py-2 text-sm font-semibold bg-[var(--amber)] text-black rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] disabled:opacity-50 cursor-pointer">
            {submitting ? "..." : intl.formatMessage({ id: "facilities.preventive.create" })}
          </button>
        </div>
      </div>
    </div>
  );
}
