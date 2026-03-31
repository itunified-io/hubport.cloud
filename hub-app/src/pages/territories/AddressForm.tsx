/**
 * Create/edit form for addresses within a territory.
 * Includes DNC workflow (status toggle, reason, optional expiry)
 * and language autocomplete.
 */
import { useState, useEffect } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { X, Save, Ban, MapPin, CalendarDays } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { getApiUrl } from "@/lib/config";
import {
  createAddress,
  updateAddress,
  type Address,
  type AddressType,
  type AddressStatus,
} from "@/lib/territory-api";

const ADDRESS_TYPES: AddressType[] = ["residential", "business", "apartment_building", "rural"];

const STATUS_OPTIONS: AddressStatus[] = [
  "active",
  "do_not_call",
  "not_at_home",
  "moved",
  "deceased",
  "foreign_language",
  "archived",
];

interface AddressFormProps {
  territoryId: string;
  address?: Address | null;
  onSave?: (address: Address) => void;
  onCancel?: () => void;
}

export function AddressForm({
  territoryId,
  address,
  onSave,
  onCancel,
}: AddressFormProps) {
  const { user } = useAuth();
  const intl = useIntl();
  const token = user?.access_token ?? "";
  const isEdit = !!address;

  // ─── Form state ───────────────────────────────────────────────

  const [streetAddress, setStreetAddress] = useState(address?.streetAddress ?? "");
  const [apartment, setApartment] = useState(address?.apartment ?? "");
  const [city, setCity] = useState(address?.city ?? "");
  const [postalCode, setPostalCode] = useState(address?.postalCode ?? "");
  const [latitude, setLatitude] = useState(address?.latitude?.toString() ?? "");
  const [longitude, setLongitude] = useState(address?.longitude?.toString() ?? "");
  const [type, setType] = useState<AddressType>(address?.type ?? "residential");
  const [status, setStatus] = useState<AddressStatus>(address?.status ?? "active");
  const [languageSpoken, setLanguageSpoken] = useState(address?.languageSpoken ?? "");
  const [bellCount, setBellCount] = useState(address?.bellCount?.toString() ?? "");
  const [notes, setNotes] = useState(address?.notes ?? "");
  const [doNotCallReason, setDoNotCallReason] = useState(address?.doNotCallReason ?? "");
  const [doNotVisitUntil, setDoNotVisitUntil] = useState(
    address?.doNotVisitUntil ? address.doNotVisitUntil.slice(0, 10) : "",
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Language autocomplete ────────────────────────────────────

  const [knownLanguages, setKnownLanguages] = useState<string[]>([]);
  const [showLangSuggestions, setShowLangSuggestions] = useState(false);

  useEffect(() => {
    if (!token) return;
    // Fetch known languages from existing addresses
    const fetchLangs = async () => {
      try {
        const res = await fetch(
          `${getApiUrl()}/territories/${territoryId}/addresses?fields=languages`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (res.ok) {
          const data = (await res.json()) as { languages?: string[] };
          if (data.languages) setKnownLanguages(data.languages);
        }
      } catch {
        // non-critical
      }
    };
    void fetchLangs();
  }, [token, territoryId]);

  const langSuggestions = knownLanguages.filter(
    (l) => languageSpoken && l.toLowerCase().startsWith(languageSpoken.toLowerCase()),
  );

  // ─── DNC status logic ─────────────────────────────────────────

  const isDnc = status === "do_not_call";

  // ─── Submit ───────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!streetAddress.trim()) return;

    setSaving(true);
    setError(null);

    const payload: Partial<Address> = {
      streetAddress: streetAddress.trim(),
      apartment: apartment.trim() || null,
      city: city.trim() || null,
      postalCode: postalCode.trim() || null,
      latitude: latitude ? parseFloat(latitude) : null,
      longitude: longitude ? parseFloat(longitude) : null,
      type,
      status,
      languageSpoken: languageSpoken.trim() || null,
      bellCount: bellCount ? parseInt(bellCount, 10) : null,
      notes: notes.trim() || null,
      doNotCallReason: isDnc ? doNotCallReason.trim() || null : null,
      doNotVisitUntil: isDnc && doNotVisitUntil ? new Date(doNotVisitUntil).toISOString() : null,
    };

    try {
      let saved: Address;
      if (isEdit && address) {
        saved = await updateAddress(territoryId, address.addressId, payload, token);
      } else {
        saved = await createAddress(territoryId, payload, token);
      }
      onSave?.(saved);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : intl.formatMessage({ id: "common.error", defaultMessage: "An error occurred" }),
      );
    } finally {
      setSaving(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full bg-[var(--bg-1)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <h2 className="text-sm font-semibold text-[var(--text)] flex items-center gap-2">
          <MapPin size={16} className="text-[var(--amber)]" />
          {isEdit ? (
            <FormattedMessage id="territories.editAddress" defaultMessage="Edit Address" />
          ) : (
            <FormattedMessage id="territories.newAddress" defaultMessage="New Address" />
          )}
        </h2>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="p-1 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Form fields */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Street address (required) */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
            <FormattedMessage id="territories.streetAddress" defaultMessage="Street address" /> *
          </label>
          <input
            type="text"
            value={streetAddress}
            onChange={(e) => setStreetAddress(e.target.value)}
            required
            className="w-full px-3 py-2 text-sm bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] focus:outline-none focus:border-[var(--amber)]"
          />
        </div>

        {/* Apartment & Postal/City row */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
              <FormattedMessage id="territories.apartment" defaultMessage="Apt" />
            </label>
            <input
              type="text"
              value={apartment}
              onChange={(e) => setApartment(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] focus:outline-none focus:border-[var(--amber)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
              <FormattedMessage id="territories.postalCode" defaultMessage="Postal" />
            </label>
            <input
              type="text"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] focus:outline-none focus:border-[var(--amber)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
              <FormattedMessage id="territories.city" defaultMessage="City" />
            </label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] focus:outline-none focus:border-[var(--amber)]"
            />
          </div>
        </div>

        {/* Coordinates */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
              <FormattedMessage id="territories.latitude" defaultMessage="Latitude" />
            </label>
            <input
              type="number"
              step="any"
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] focus:outline-none focus:border-[var(--amber)]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
              <FormattedMessage id="territories.longitude" defaultMessage="Longitude" />
            </label>
            <input
              type="number"
              step="any"
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] focus:outline-none focus:border-[var(--amber)]"
            />
          </div>
        </div>

        {/* Type & Status */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
              <FormattedMessage id="territories.addressType" defaultMessage="Type" />
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as AddressType)}
              className="w-full px-3 py-2 text-sm bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] cursor-pointer"
            >
              {ADDRESS_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace("_", " ")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
              <FormattedMessage id="territories.status" defaultMessage="Status" />
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as AddressStatus)}
              className="w-full px-3 py-2 text-sm bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] cursor-pointer"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* DNC section */}
        {isDnc && (
          <div className="p-3 rounded-[var(--radius)] border border-[var(--red)] bg-[#ef444414] space-y-3">
            <div className="flex items-center gap-2 text-xs font-medium text-[var(--red)]">
              <Ban size={14} />
              <FormattedMessage id="territories.dncSettings" defaultMessage="Do Not Call Settings" />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
                <FormattedMessage id="territories.dncReason" defaultMessage="Reason" />
              </label>
              <input
                type="text"
                value={doNotCallReason}
                onChange={(e) => setDoNotCallReason(e.target.value)}
                placeholder={intl.formatMessage({
                  id: "territories.dncReasonPlaceholder",
                  defaultMessage: "e.g. aggressive dog, private property",
                })}
                className="w-full px-3 py-2 text-sm bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] focus:outline-none focus:border-[var(--red)]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1 flex items-center gap-1">
                <CalendarDays size={12} />
                <FormattedMessage id="territories.dncExpiry" defaultMessage="Expires (optional)" />
              </label>
              <input
                type="date"
                value={doNotVisitUntil}
                onChange={(e) => setDoNotVisitUntil(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] focus:outline-none focus:border-[var(--amber)]"
              />
              <p className="text-[10px] text-[var(--text-muted)] mt-1">
                <FormattedMessage
                  id="territories.dncExpiryHint"
                  defaultMessage="Leave empty for permanent do-not-call. Set a date for temporary."
                />
              </p>
            </div>
          </div>
        )}

        {/* Language with autocomplete */}
        <div className="relative">
          <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
            <FormattedMessage id="territories.language" defaultMessage="Language spoken" />
          </label>
          <input
            type="text"
            value={languageSpoken}
            onChange={(e) => {
              setLanguageSpoken(e.target.value);
              setShowLangSuggestions(true);
            }}
            onFocus={() => setShowLangSuggestions(true)}
            onBlur={() => setTimeout(() => setShowLangSuggestions(false), 150)}
            className="w-full px-3 py-2 text-sm bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] focus:outline-none focus:border-[var(--amber)]"
          />
          {showLangSuggestions && langSuggestions.length > 0 && (
            <ul className="absolute z-10 w-full mt-1 bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] shadow-lg max-h-32 overflow-y-auto">
              {langSuggestions.map((lang) => (
                <li key={lang}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--glass)] cursor-pointer"
                    onMouseDown={() => {
                      setLanguageSpoken(lang);
                      setShowLangSuggestions(false);
                    }}
                  >
                    {lang}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Bell count */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
            <FormattedMessage id="territories.bellCount" defaultMessage="Bell count" />
          </label>
          <input
            type="number"
            min="0"
            value={bellCount}
            onChange={(e) => setBellCount(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] focus:outline-none focus:border-[var(--amber)]"
          />
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
            <FormattedMessage id="territories.notes" defaultMessage="Notes" />
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 text-sm bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)] focus:outline-none focus:border-[var(--amber)] resize-none"
          />
        </div>

        {/* Error */}
        {error && (
          <div className="px-3 py-2 rounded-[var(--radius-sm)] bg-[#ef444414] text-xs text-[var(--red)]">
            {error}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="p-4 border-t border-[var(--border)] flex items-center gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2 text-sm font-medium text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:bg-[var(--glass)] transition-colors cursor-pointer"
          >
            <FormattedMessage id="common.cancel" defaultMessage="Cancel" />
          </button>
        )}
        <button
          type="submit"
          disabled={saving || !streetAddress.trim()}
          className="flex-1 py-2 text-sm font-semibold text-black bg-[var(--amber)] rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {saving ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black" />
          ) : (
            <Save size={14} />
          )}
          <FormattedMessage id="common.save" defaultMessage="Save" />
        </button>
      </div>
    </form>
  );
}
