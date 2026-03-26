/**
 * Speaker self-service: manage own talks and sharing preferences.
 * Only rendered when the current user has a linked Speaker record.
 */
import { useState, useEffect } from "react";
import { FormattedMessage, useIntl } from "react-intl";
import { Mic, Plus, X, Phone, Mail, Calendar, Hash } from "lucide-react";
import { useAuth } from "@/auth/useAuth";
import { getApiUrl } from "@/lib/config";

interface PublicTalk {
  id: string;
  talkNumber: number;
  title: string;
}

interface SpeakerTalk {
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
  const intl = useIntl();
  const [speaker, setSpeaker] = useState<SpeakerProfile | null>(null);
  const [allTalks, setAllTalks] = useState<PublicTalk[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddTalk, setShowAddTalk] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sharingPrefs, setSharingPrefs] = useState({
    sharePhone: false,
    shareEmail: false,
    shareAvailability: true,
    monthlyInviteCap: 4,
  });

  const apiUrl = getApiUrl();
  const headers = { Authorization: `Bearer ${user?.access_token}`, "Content-Type": "application/json" };

  useEffect(() => {
    const load = async () => {
      try {
        const [speakerRes, talksRes] = await Promise.all([
          fetch(`${apiUrl}/speakers/me`, { headers }),
          fetch(`${apiUrl}/public-talks`, { headers }),
        ]);

        if (speakerRes.ok) {
          const data = (await speakerRes.json()) as SpeakerProfile;
          setSpeaker(data);
          setSharingPrefs({
            sharePhone: data.sharePhone,
            shareEmail: data.shareEmail,
            shareAvailability: data.shareAvailability,
            monthlyInviteCap: data.monthlyInviteCap,
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
  }, [user?.access_token]);

  const registerAsSpeaker = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/speakers/me`, {
        method: "POST",
        headers,
      });
      if (res.ok) {
        const data = (await res.json()) as SpeakerProfile;
        setSpeaker(data);
        setSharingPrefs({
          sharePhone: data.sharePhone,
          shareEmail: data.shareEmail,
          shareAvailability: data.shareAvailability,
          monthlyInviteCap: data.monthlyInviteCap,
        });
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  if (!speaker) {
    return (
      <div className="p-4 border border-[var(--border)] rounded-[var(--radius)] bg-[var(--bg-1)] space-y-3">
        <h2 className="text-sm font-medium text-[var(--text)] flex items-center gap-2">
          <Mic size={14} />
          <FormattedMessage id="speaker.register" />
        </h2>
        <p className="text-sm text-[var(--text-muted)]">
          <FormattedMessage id="speaker.register.hint" />
        </p>
        <button
          onClick={registerAsSpeaker}
          disabled={saving}
          className="px-4 py-2 text-sm font-semibold bg-[var(--amber)] text-black rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer disabled:opacity-50"
        >
          {saving ? "..." : <FormattedMessage id="speaker.register.button" />}
        </button>
      </div>
    );
  }

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

  const saveSharingPrefs = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/speakers/me/sharing`, {
        method: "PUT",
        headers,
        body: JSON.stringify(sharingPrefs),
      });
      if (res.ok) {
        const updated = (await res.json()) as typeof sharingPrefs;
        setSharingPrefs(updated);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* My Talks */}
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
                  key={t.publicTalk.id}
                  className="flex items-center justify-between px-3 py-2 bg-[var(--bg-2)] rounded-[var(--radius-sm)]"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="shrink-0 w-8 text-xs font-mono text-[var(--amber)]">
                      #{t.publicTalk.talkNumber}
                    </span>
                    <span className="text-sm text-[var(--text)] truncate">{t.publicTalk.title}</span>
                  </div>
                  <button
                    onClick={() => removeTalk(t.publicTalk.talkNumber)}
                    disabled={saving}
                    className="shrink-0 p-1 text-[var(--text-muted)] hover:text-[var(--red)] transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <X size={14} />
                  </button>
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
                className={`relative w-9 h-5 rounded-full transition-colors ${
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

          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--text-muted)]">
              <FormattedMessage id="speaker.monthlyInviteCap" />
            </span>
            <input
              type="number"
              min={1}
              max={12}
              value={sharingPrefs.monthlyInviteCap}
              onChange={(e) =>
                setSharingPrefs((p) => ({ ...p, monthlyInviteCap: parseInt(e.target.value) || 4 }))
              }
              className="w-16 px-2 py-1 text-sm text-center bg-[var(--bg-2)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text)]"
            />
          </div>
        </div>

        <button
          onClick={saveSharingPrefs}
          disabled={saving}
          className="w-full py-2 text-sm font-semibold bg-[var(--amber)] text-black rounded-[var(--radius-sm)] hover:bg-[var(--amber-light)] transition-colors cursor-pointer disabled:opacity-50"
        >
          {saving ? "..." : <FormattedMessage id="common.save" />}
        </button>
      </div>
    </>
  );
}
