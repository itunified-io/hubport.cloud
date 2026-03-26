/**
 * Speaker self-service: manage own talks and sharing preferences.
 * Only visible to users with the "Public Talk" AppRole (privilege:publicTalk).
 * Auto-provisions a Speaker record via GET /speakers/me when the role is granted.
 */
import { useState, useEffect } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Mic, Plus, X, Phone, Mail, Calendar, Hash } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { usePermissions } from "@/auth/PermissionProvider";
import { getApiUrl } from "@/lib/config";

interface PublicTalk {
  id: string;
  talkNumber: number;
  title: string;
}

interface SpeakerTalk {
  id: string;
  muted: boolean;
  publicTalk: PublicTalk;
}

interface SpeakerProfile {
  id: string;
  firstName: string;
  lastName: string;
  sharePhone: boolean;
  shareEmail: boolean;
  shareAvailability: boolean;
  monthlyInviteCap: number;
  talks: SpeakerTalk[];
}

export function SpeakerTalksSection() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const intl = useIntl();
  const [speaker, setSpeaker] = useState<SpeakerProfile | null>(null);
  const [allTalks, setAllTalks] = useState<PublicTalk[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddTalk, setShowAddTalk] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [monthlyInviteCap, setMonthlyInviteCap] = useState(2);
  const [sharingPrefs, setSharingPrefs] = useState({
    sharePhone: false,
    shareEmail: false,
    shareAvailability: true,
  });

  // RBAC gate: only show for users with privilege:publicTalk
  const hasPublicTalkRole = can("privilege:publicTalk");

  const apiUrl = getApiUrl();
  const headers = { Authorization: `Bearer ${user?.access_token}`, "Content-Type": "application/json" };

  useEffect(() => {
    if (!hasPublicTalkRole) {
      setLoading(false);
      return;
    }
    const load = async () => {
      try {
        const [speakerRes, talksRes] = await Promise.all([
          fetch(`${apiUrl}/speakers/me`, { headers }),
          fetch(`${apiUrl}/public-talks`, { headers }),
        ]);

        if (speakerRes.ok) {
          const data = (await speakerRes.json()) as SpeakerProfile;
          setSpeaker(data);
          setMonthlyInviteCap(data.monthlyInviteCap);
          setSharingPrefs({
            sharePhone: data.sharePhone,
            shareEmail: data.shareEmail,
            shareAvailability: data.shareAvailability,
          });
        }

        if (talksRes.ok) {
          setAllTalks((await talksRes.json()) as PublicTalk[]);
        }
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user?.access_token, hasPublicTalkRole]);

  // Not a public speaker — hide section entirely
  if (!hasPublicTalkRole || loading || !speaker) return null;

  const myTalkNumbers = new Set(speaker.talks.map((t) => t.publicTalk.talkNumber));

  const availableTalks = allTalks
    .filter((t) => !myTalkNumbers.has(t.talkNumber))
    .filter(
      (t) =>
        !searchQuery ||
        t.talkNumber.toString().includes(searchQuery) ||
        t.title.toLowerCase().includes(searchQuery.toLowerCase()),
    );

  const addTalk = async (talkNumber: number) => {
    const newNumbers = [...Array.from(myTalkNumbers), talkNumber];
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/speakers/me/talks`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ talkNumbers: newNumbers }),
      });
      if (res.ok) {
        const updated = (await res.json()) as SpeakerProfile;
        setSpeaker(updated);
      }
    } finally {
      setSaving(false);
    }
  };

  const removeTalk = async (talkNumber: number) => {
    const newNumbers = Array.from(myTalkNumbers).filter((n) => n !== talkNumber);
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/speakers/me/talks`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ talkNumbers: newNumbers }),
      });
      if (res.ok) {
        const updated = (await res.json()) as SpeakerProfile;
        setSpeaker(updated);
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleMute = async (speakerTalkId: string) => {
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/speakers/me/talks/${speakerTalkId}/mute`, {
        method: "PUT",
        headers,
      });
      if (res.ok) {
        const updated = (await res.json()) as SpeakerTalk;
        setSpeaker((prev) =>
          prev
            ? { ...prev, talks: prev.talks.map((t) => (t.id === updated.id ? updated : t)) }
            : prev,
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/speakers/me/sharing`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ ...sharingPrefs, monthlyInviteCap }),
      });
      if (res.ok) {
        const updated = (await res.json()) as SpeakerProfile;
        setMonthlyInviteCap(updated.monthlyInviteCap);
        setSharingPrefs({
          sharePhone: updated.sharePhone,
          shareEmail: updated.shareEmail,
          shareAvailability: updated.shareAvailability,
        });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* Speaker Section: Availability + Talks */}
      <div className="p-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-[var(--text)] flex items-center gap-2">
            <Mic size={14} />
            <FormattedMessage id="speaker.myTalks" />
          </h2>
          <button
            onClick={() => setShowAddTalk(!showAddTalk)}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-[var(--amber)] bg-[#d9770614] rounded-[var(--radius-sm)] hover:bg-[#d9770628] transition-colors cursor-pointer"
          >
            <Plus size={12} />
            <FormattedMessage id="speaker.addTalk" />
          </button>
        </div>

        {/* Monthly availability */}
        <div className="flex items-center justify-between px-3 py-2 bg-[var(--bg-2)] rounded-[var(--radius-sm)]">
          <span className="text-sm text-[var(--text-muted)]">
            <FormattedMessage id="speaker.monthlyAvailability" />
          </span>
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                onClick={() => setMonthlyInviteCap(n)}
                className={`w-8 h-8 rounded-full text-xs font-semibold transition-colors cursor-pointer ${
                  monthlyInviteCap === n
                    ? "bg-[var(--amber)] text-black"
                    : "bg-[var(--glass-1)] text-[var(--text-muted)] hover:bg-[var(--glass-2)]"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Talk list with mute toggles */}
        {speaker.talks.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            <FormattedMessage id="speaker.noTalks" />
          </p>
        ) : (
          <div className="space-y-1">
            {speaker.talks
              .sort((a, b) => a.publicTalk.talkNumber - b.publicTalk.talkNumber)
              .map((t) => (
                <div
                  key={t.id}
                  className={`flex items-center justify-between px-3 py-2 bg-[var(--bg-2)] rounded-[var(--radius-sm)] transition-opacity ${
                    t.muted ? "opacity-50" : ""
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="shrink-0 w-8 text-xs font-mono text-[var(--amber)]">
                      #{t.publicTalk.talkNumber}
                    </span>
                    <span className={`text-sm truncate ${t.muted ? "text-[var(--text-muted)] line-through" : "text-[var(--text)]"}`}>
                      {t.publicTalk.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Mute toggle */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!t.muted}
                      disabled={saving}
                      onClick={() => toggleMute(t.id)}
                      title={intl.formatMessage({ id: t.muted ? "speaker.unmuteTalk" : "speaker.muteTalk" })}
                      className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer disabled:opacity-50 ${
                        !t.muted ? "bg-[var(--amber)]" : "bg-[var(--glass-2)]"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                          !t.muted ? "translate-x-4" : ""
                        }`}
                      />
                    </button>
                    {/* Remove */}
                    <button
                      onClick={() => removeTalk(t.publicTalk.talkNumber)}
                      disabled={saving}
                      className="p-1 text-[var(--text-muted)] hover:text-[var(--red)] transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <X size={12} />
                    </button>
                  </div>
                </div>
              ))}
          </div>
        )}

        {/* Add talk search dropdown */}
        {showAddTalk && (
          <div className="border border-[var(--border)] rounded-[var(--radius-sm)] bg-[var(--bg-2)] overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
              <Hash size={14} className="text-[var(--text-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={intl.formatMessage({ id: "speaker.searchTalks" })}
                className="flex-1 text-sm bg-transparent text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none"
                autoFocus
              />
            </div>
            <div className="max-h-48 overflow-y-auto">
              {availableTalks.slice(0, 20).map((t) => (
                <button
                  key={t.id}
                  onClick={() => addTalk(t.talkNumber)}
                  disabled={saving}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--glass-1)] transition-colors cursor-pointer disabled:opacity-50"
                >
                  <span className="shrink-0 w-8 text-xs font-mono text-[var(--amber)]">#{t.talkNumber}</span>
                  <span className="text-sm text-[var(--text)] truncate">{t.title}</span>
                </button>
              ))}
              {availableTalks.length === 0 && (
                <p className="px-3 py-2 text-sm text-[var(--text-muted)]">
                  <FormattedMessage id="speaker.noMatchingTalks" />
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Sharing Preferences */}
      <div className="p-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] space-y-4">
        <h2 className="text-sm font-medium text-[var(--text)]">
          <FormattedMessage id="speaker.sharingPrefs" />
        </h2>

        <div className="space-y-3">
          {([
            { key: "sharePhone", icon: Phone, label: "speaker.sharePhone" },
            { key: "shareEmail", icon: Mail, label: "speaker.shareEmail" },
            { key: "shareAvailability", icon: Calendar, label: "speaker.shareAvailability" },
          ] as const).map(({ key, icon: Icon, label }) => (
            <label key={key} className="flex items-center justify-between cursor-pointer">
              <span className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                <Icon size={14} />
                <FormattedMessage id={label} />
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={sharingPrefs[key]}
                onClick={() => setSharingPrefs((p) => ({ ...p, [key]: !p[key] }))}
                className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${
                  sharingPrefs[key] ? "bg-[var(--amber)]" : "bg-[var(--glass-2)]"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                    sharingPrefs[key] ? "translate-x-4" : ""
                  }`}
                />
              </button>
            </label>
          ))}
        </div>

        <button
          onClick={saveSettings}
          disabled={saving}
          className="w-full py-2 text-sm font-semibold bg-[var(--amber)] text-black rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer disabled:opacity-50"
        >
          {saving ? "..." : <FormattedMessage id="common.save" />}
        </button>
      </div>
    </>
  );
}
