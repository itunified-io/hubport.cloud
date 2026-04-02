import { useState, useEffect } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import {
  User,
  Shield,
  AlertTriangle,
  Trash2,
  MapPin,
  Lock,
  Monitor,
  Eye,
  Settings,
} from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { getApiUrl } from "@/lib/config";
import { SecuritySection } from "./SecuritySection";
import { DevicesSection } from "./DevicesSection";
import { AvailabilitySection } from "./AvailabilitySection";
import { SpeakerTalksSection } from "./SpeakerTalksSection";

interface PublisherProfile {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  congregationRole: string;
  congregationFlags: string[];
  privacyAccepted: boolean;
  privacySettings: {
    contactVisibility: string;
    addressVisibility: string;
    notesVisibility: string;
  };
  allowLocationSharing: boolean;
  appRoles: { role: { name: string } }[];
}

const VISIBILITY_OPTIONS = ["everyone", "elders_only", "nobody"] as const;

type TabId = "security" | "devices" | "privacy" | "account";

const TABS: { id: TabId; icon: typeof Lock; labelId: string }[] = [
  { id: "security", icon: Lock, labelId: "security.profile.title" },
  { id: "devices", icon: Monitor, labelId: "profile.tab.devices" },
  { id: "privacy", icon: Eye, labelId: "privacy.title" },
  { id: "account", icon: Settings, labelId: "profile.tab.account" },
];

export function Profile() {
  const { user, signOut } = useAuth();
  const intl = useIntl();
  const [profile, setProfile] = useState<PublisherProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("security");
  const [privacy, setPrivacy] = useState({
    contactVisibility: "elders_only",
    addressVisibility: "elders_only",
    notesVisibility: "elders_only",
  });
  const [allowLocationSharing, setAllowLocationSharing] = useState(false);
  const apiUrl = getApiUrl();
  const headers = {
    Authorization: `Bearer ${user?.access_token}`,
    "Content-Type": "application/json",
  };

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await fetch(`${apiUrl}/publishers/me`, { headers });
        if (res.ok) {
          const data = (await res.json()) as PublisherProfile;
          setProfile(data);
          if (data.privacySettings) {
            setPrivacy(data.privacySettings);
          }
          setAllowLocationSharing(data.allowLocationSharing ?? false);
        }
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, [user?.access_token]);

  const savePrivacy = async () => {
    setSaving(true);
    try {
      await fetch(`${apiUrl}/publishers/me/privacy`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ ...privacy, allowLocationSharing }),
      });
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async () => {
    if (!confirm("Are you sure you want to deactivate your account?")) return;
    await fetch(`${apiUrl}/publishers/me/deactivate`, {
      method: "POST",
      headers,
    });
    signOut();
  };

  const gdprDelete = async () => {
    if (
      !confirm(
        "This will permanently delete your account and all data. This cannot be undone. Continue?",
      )
    )
      return;
    await fetch(`${apiUrl}/publishers/me`, { method: "DELETE", headers });
    signOut();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-[var(--amber)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-xl space-y-4">
      {/* Profile card — always visible */}
      {profile && (
        <div className="p-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)]">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-[var(--glass-2)] flex items-center justify-center">
              <User size={18} className="text-[var(--text-muted)]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[var(--text)] font-medium truncate">
                {profile.displayName ??
                  `${profile.firstName} ${profile.lastName}`}
              </p>
              <p className="text-xs text-[var(--text-muted)] capitalize">
                {profile.congregationRole.replace(/_/g, " ")}
                {profile.congregationFlags.length > 0 &&
                  ` · ${profile.congregationFlags.join(", ")}`}
              </p>
            </div>
            {profile.appRoles.length > 0 && (
              <div className="flex flex-wrap gap-1 shrink-0">
                {profile.appRoles.map((ar) => (
                  <span
                    key={ar.role.name}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium text-[var(--amber)] bg-[#d9770614]"
                  >
                    <Shield size={10} />
                    {ar.role.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-[var(--border)]">
        {TABS.map(({ id, icon: Icon, labelId }) => {
          // Hide privacy/account tabs if no publisher profile
          if ((id === "privacy" || id === "account") && !profile) return null;
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors cursor-pointer border-b-2 -mb-px ${
                active
                  ? "border-[var(--amber)] text-[var(--amber)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              <Icon size={13} />
              {intl.formatMessage({
                id: labelId,
                defaultMessage: id,
              })}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "security" && <SecuritySection />}

      {activeTab === "devices" && <DevicesSection />}

      {activeTab === "privacy" && profile && (
        <div className="p-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] space-y-4">
          {(
            [
              "contactVisibility",
              "addressVisibility",
              "notesVisibility",
            ] as const
          ).map((key) => (
            <div key={key} className="flex items-center justify-between">
              <label className="text-sm text-[var(--text-muted)]">
                <FormattedMessage id={`privacy.${key}`} />
              </label>
              <select
                value={privacy[key]}
                onChange={(e) =>
                  setPrivacy((prev) => ({ ...prev, [key]: e.target.value }))
                }
                className="px-3 py-1.5 text-sm bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]"
              >
                {VISIBILITY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
          ))}

          {/* Location sharing toggle */}
          <div className="pt-3 mt-3 border-t border-[var(--border)]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin size={14} className="text-[var(--amber)]" />
                <div>
                  <label className="text-sm text-[var(--text)]">
                    <FormattedMessage id="privacy.allowLocationSharing" />
                  </label>
                  <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                    <FormattedMessage id="privacy.allowLocationSharing.description" />
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAllowLocationSharing((v) => !v)}
                className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${
                  allowLocationSharing
                    ? "bg-[var(--green)]"
                    : "bg-[var(--glass-2)]"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                    allowLocationSharing ? "translate-x-5" : ""
                  }`}
                />
              </button>
            </div>
          </div>

          <button
            onClick={savePrivacy}
            disabled={saving}
            className="w-full py-2 text-sm font-semibold bg-[var(--amber)] text-black rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer disabled:opacity-50"
          >
            {saving ? "..." : <FormattedMessage id="common.save" />}
          </button>
        </div>
      )}

      {activeTab === "account" && profile && (
        <div className="space-y-4">
          {/* Availability */}
          <AvailabilitySection publisherId={profile.id} />

          {/* Speaker talks */}
          <SpeakerTalksSection />

          {/* Danger zone */}
          <div className="p-4 border border-[var(--red)] border-opacity-30 rounded-[var(--radius)] bg-[var(--bg-1)] space-y-3">
            <h2 className="text-sm font-medium text-[var(--red)] flex items-center gap-2">
              <AlertTriangle size={14} />
              <FormattedMessage id="profile.danger" />
            </h2>
            <div className="flex gap-3">
              <button
                onClick={deactivate}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--text-muted)] border border-[var(--border)] rounded-[var(--radius-sm)] hover:text-[var(--red)] hover:border-[var(--red)] transition-colors cursor-pointer"
              >
                <FormattedMessage id="profile.deactivate" />
              </button>
              <button
                onClick={gdprDelete}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--red)] border border-[var(--red)] border-opacity-30 rounded-[var(--radius-sm)] hover:bg-[#ef444414] transition-colors cursor-pointer"
              >
                <Trash2 size={14} />
                <FormattedMessage id="profile.delete" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
