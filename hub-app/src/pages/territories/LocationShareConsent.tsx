import { useState } from "react";
import { MapPin, Clock, Shield, X } from "lucide-react";

type Duration = "one_hour" | "four_hours" | "eight_hours";

const DURATION_OPTIONS: { value: Duration; label: string }[] = [
  { value: "one_hour", label: "1 hour" },
  { value: "four_hours", label: "4 hours" },
  { value: "eight_hours", label: "8 hours" },
];

interface LocationShareConsentProps {
  onConsent: (duration: Duration) => void;
  onDismiss: () => void;
}

export function LocationShareConsent({ onConsent, onDismiss }: LocationShareConsentProps) {
  const [duration, setDuration] = useState<Duration>("one_hour");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onDismiss} />
      <div className="relative bg-[var(--bg-1)] border border-[var(--border)] rounded-[var(--radius)] w-full max-w-sm p-6 space-y-5 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin size={18} className="text-[var(--amber)]" />
            <h2 className="text-sm font-semibold text-[var(--text)]">Share Your Location</h2>
          </div>
          <button
            onClick={onDismiss}
            className="p-1 rounded hover:bg-[var(--glass)] transition-colors cursor-pointer"
          >
            <X size={16} className="text-[var(--text-muted)]" />
          </button>
        </div>

        {/* Privacy explanation */}
        <div className="p-3 bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] space-y-2">
          <div className="flex items-start gap-2">
            <Shield size={14} className="text-[var(--blue)] mt-0.5 flex-shrink-0" />
            <div className="text-xs text-[var(--text-muted)] space-y-1">
              <p>Your location will be shared with your field group conductor for the selected duration only.</p>
              <p>When the timer expires, your location data is automatically deleted. No historical location data is stored.</p>
              <p>You can stop sharing at any time.</p>
            </div>
          </div>
        </div>

        {/* Duration picker */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-[var(--text-muted)] flex items-center gap-1">
            <Clock size={12} /> How long?
          </label>
          <div className="flex gap-2">
            {DURATION_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDuration(opt.value)}
                className={`flex-1 py-2 text-sm font-medium rounded-[var(--radius-sm)] border transition-colors cursor-pointer ${
                  duration === opt.value
                    ? "border-[var(--amber)] bg-[#d9770614] text-[var(--amber)]"
                    : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--border-2)]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={onDismiss}
            className="flex-1 py-2 text-sm text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
          >
            Not now
          </button>
          <button
            onClick={() => onConsent(duration)}
            className="flex-1 py-2 text-sm font-semibold bg-[var(--amber)] text-black rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer"
          >
            Share Location
          </button>
        </div>
      </div>
    </div>
  );
}
