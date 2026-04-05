import { useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { X } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { getApiUrl } from "@/lib/config";

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export function MaintenanceForm({ onClose, onCreated }: Props) {
  const { user } = useAuth();
  const intl = useIntl();
  const apiUrl = getApiUrl();
  const headers = { Authorization: `Bearer ${user?.access_token}`, "Content-Type": "application/json" };

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("other");
  const [priority, setPriority] = useState("medium");
  const [location, setLocation] = useState("");
  const [photos, setPhotos] = useState<{ data: string; mimeType: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      if (!["image/jpeg", "image/png"].includes(file.type)) continue;
      if (photos.length >= 10) break;
      // Resize and convert to base64
      const canvas = document.createElement("canvas");
      const img = new Image();
      const reader = new FileReader();
      await new Promise<void>((resolve) => {
        reader.onload = () => {
          img.onload = () => {
            const maxDim = 1920;
            let { width, height } = img;
            if (width > maxDim || height > maxDim) {
              const ratio = Math.min(maxDim / width, maxDim / height);
              width *= ratio;
              height *= ratio;
            }
            canvas.width = width;
            canvas.height = height;
            canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
            const base64 = canvas.toDataURL(file.type).split(",")[1];
            setPhotos((prev) => [...prev, { data: base64, mimeType: file.type }]);
            resolve();
          };
          img.src = reader.result as string;
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const submit = async () => {
    if (!title || !description) return;
    setSubmitting(true);
    try {
      const res = await fetch(`${apiUrl}/facilities/maintenance`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title, description, category, priority, location: location || undefined }),
      });
      if (res.ok) {
        const issue = await res.json() as { id: string };
        // Upload photos
        for (const photo of photos) {
          await fetch(`${apiUrl}/facilities/maintenance/${issue.id}/photos`, {
            method: "POST",
            headers,
            body: JSON.stringify(photo),
          });
        }
        onCreated();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius)] p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-[var(--text)]"><FormattedMessage id="facilities.maintenance.create" /></h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"><X size={18} /></button>
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="w-full px-3 py-2 text-sm bg-[var(--input)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]" />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" rows={3} className="w-full px-3 py-2 text-sm bg-[var(--input)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]" />
        <div className="grid grid-cols-2 gap-3">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="px-3 py-2 text-sm bg-[var(--input)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]">
            {["electrical", "plumbing", "hvac", "structural", "safety", "grounds", "interior", "audio_video", "other"].map((c) => (
              <option key={c} value={c}>{intl.formatMessage({ id: `facilities.category.${c}` })}</option>
            ))}
          </select>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className="px-3 py-2 text-sm bg-[var(--input)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]">
            {["low", "medium", "high", "critical"].map((p) => (
              <option key={p} value={p}>{intl.formatMessage({ id: `facilities.priority.${p}` })}</option>
            ))}
          </select>
        </div>
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location (optional)" className="w-full px-3 py-2 text-sm bg-[var(--input)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]" />
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1">Photos (max 10, JPEG/PNG)</label>
          <input type="file" accept="image/jpeg,image/png" multiple onChange={handlePhoto} className="text-sm text-[var(--text-muted)]" />
          {photos.length > 0 && <p className="text-xs text-[var(--text-muted)] mt-1">{photos.length} photo(s) attached</p>}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] cursor-pointer">Cancel</button>
          <button onClick={submit} disabled={!title || !description || submitting} className="px-4 py-2 text-sm font-semibold bg-[var(--amber)] text-black rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] disabled:opacity-50 transition-colors cursor-pointer">
            {submitting ? "..." : intl.formatMessage({ id: "facilities.maintenance.create" })}
          </button>
        </div>
      </div>
    </div>
  );
}
