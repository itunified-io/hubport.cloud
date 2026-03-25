// hub-app/src/pages/meetings/planner/weekend/ProgramCard.tsx
import { Mic, Music, HandHelping, BookOpen, ExternalLink } from "lucide-react";
import { WEEKEND_COLORS, INVITATION_BADGES } from "./constants";
import type { WeekendMeeting, Assignment, Publisher, TalkSchedule } from "./types";

interface ProgramCardProps {
  meeting: WeekendMeeting;
  locked: boolean;
  onEditAssignment: (assignmentId: string, slotKey: string, title: string) => void;
  onEditTalk: () => void;
}

export function ProgramCard({ meeting, locked, onEditAssignment, onEditTalk }: ProgramCardProps) {
  const assignments = meeting.assignments ?? [];
  const studyWeek = meeting.weekendStudyWeek;
  const talkSchedule = meeting.talkSchedules?.[0];

  // Find key assignments by slot key
  const chairman = assignments.find((a) => a.slotTemplate.slotKey.startsWith("chairman"));
  const openingPrayer = assignments.find((a) => a.slotTemplate.slotKey.startsWith("opening_prayer"));
  const closingPrayer = assignments.find((a) => a.slotTemplate.slotKey.startsWith("closing_prayer"));
  const wtConductor = assignments.find((a) => a.slotTemplate.slotKey === "wt_conductor");
  const wtReader = assignments.find((a) => a.slotTemplate.slotKey === "wt_reader");

  // Song numbers from study week data
  const songs = studyWeek?.songNumbers ?? [];

  return (
    <div className="rounded-[var(--radius)] overflow-hidden border border-[var(--border)] bg-[var(--bg-1)] shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
      {/* Chairman — amber tint */}
      <ChairmanRow assignment={chairman} locked={locked} onEdit={onEditAssignment} />

      {/* Opening Song — talk-green border */}
      {songs[0] != null && <SongBar number={songs[0]} section="talk" />}

      {/* Opening Prayer */}
      <PrayerRow
        label="Gebet"
        assignment={openingPrayer}
        locked={locked}
        onEdit={onEditAssignment}
      />

      {/* PUBLIC TALK section */}
      <div className={`px-3.5 py-1.5 ${WEEKEND_COLORS.talk.header}`}>
        <span className="text-[10px] font-bold uppercase tracking-[1px] text-white/95">
          Offentlicher Vortrag
        </span>
      </div>
      <div className={WEEKEND_COLORS.talk.bg}>
        <TalkInfoBlock
          talkSchedule={talkSchedule}
          locked={locked}
          onEditTalk={onEditTalk}
        />
      </div>

      {/* Middle Song — study-blue border */}
      {songs[1] != null && <SongBar number={songs[1]} section="study" />}

      {/* WATCHTOWER STUDY section */}
      <div className={`px-3.5 py-1.5 ${WEEKEND_COLORS.study.header}`}>
        <span className="text-[10px] font-bold uppercase tracking-[1px] text-white/95">
          Wachtturm-Studium
        </span>
      </div>
      <div className={WEEKEND_COLORS.study.bg}>
        <StudyInfoBlock
          studyWeek={studyWeek}
          conductor={wtConductor}
          reader={wtReader}
          locked={locked}
          onEdit={onEditAssignment}
        />
      </div>

      {/* Closing Song — study-blue border */}
      {songs[2] != null && <SongBar number={songs[2]} section="study" />}

      {/* Closing Prayer */}
      <PrayerRow
        label="Schlussgebet"
        assignment={closingPrayer}
        locked={locked}
        onEdit={onEditAssignment}
      />
    </div>
  );
}

/* ---- Sub-components ---- */

function ChairmanRow({
  assignment, locked, onEdit,
}: {
  assignment?: Assignment;
  locked: boolean;
  onEdit: (id: string, slotKey: string, title: string) => void;
}) {
  const name = formatName(assignment?.assignee);
  return (
    <div className="flex items-center gap-2.5 px-3.5 py-1.5 border-b border-white/[0.04] bg-[var(--amber)]/[0.04]">
      <Mic size={12} className="shrink-0 text-[var(--amber)]" />
      <span className="text-xs font-medium text-[var(--amber)] flex-1">Vorsitzender</span>
      <span className="text-xs font-medium">{name ?? <Unassigned />}</span>
      {!locked && assignment && (
        <EditBtn onClick={() => onEdit(assignment.id, assignment.slotTemplate.slotKey, "Vorsitzender")} />
      )}
    </div>
  );
}

function SongBar({ number, section }: { number: number; section: "talk" | "study" }) {
  const colors = WEEKEND_COLORS[section];
  return (
    <div className={`flex items-center gap-2.5 px-3.5 py-[7px] border-l-[3px] ${colors.songBorder} ${colors.songBg} ${colors.text}`}>
      <Music size={13} className="shrink-0" />
      <span className="text-xs font-medium">Lied {number}</span>
    </div>
  );
}

function PrayerRow({
  label, assignment, locked, onEdit,
}: {
  label: string;
  assignment?: Assignment;
  locked: boolean;
  onEdit: (id: string, slotKey: string, title: string) => void;
}) {
  const name = formatName(assignment?.assignee);
  return (
    <div className="flex items-center gap-2.5 px-3.5 py-1.5 bg-white/[0.015]">
      <HandHelping size={12} className="shrink-0 text-zinc-600" />
      <span className="text-xs text-[var(--text-muted)] flex-1">{label}</span>
      {name ? (
        <span className="text-xs font-medium">{name}</span>
      ) : (
        <Unassigned />
      )}
      {!locked && assignment && (
        <EditBtn onClick={() => onEdit(assignment.id, assignment.slotTemplate.slotKey, label)} />
      )}
    </div>
  );
}

function TalkInfoBlock({
  talkSchedule, locked, onEditTalk,
}: {
  talkSchedule?: TalkSchedule;
  locked: boolean;
  onEditTalk: () => void;
}) {
  if (!talkSchedule) {
    return (
      <div className="px-3.5 py-2.5 flex items-center justify-between">
        <span className="text-xs text-zinc-600 italic">Kein Vortrag zugewiesen</span>
        {!locked && (
          <EditBtn amber onClick={onEditTalk} />
        )}
      </div>
    );
  }

  const speaker = talkSchedule.speaker;
  const talk = talkSchedule.publicTalk;
  const badge = INVITATION_BADGES[talkSchedule.invitationState as keyof typeof INVITATION_BADGES]
    ?? INVITATION_BADGES.draft;

  return (
    <div className="px-3.5 py-2.5 flex flex-col gap-[3px]">
      {/* Speaker row */}
      <div className="flex items-center gap-1.5">
        <Mic size={14} className={WEEKEND_COLORS.talk.text} />
        <span className="text-[13px] font-semibold">
          {speaker.displayName ?? `${speaker.firstName} ${speaker.lastName}`}
        </span>
        {speaker.congregationName && (
          <span className="text-[10px] text-zinc-600">{speaker.congregationName}</span>
        )}
        <span className={`text-[8px] font-semibold px-1.5 py-px rounded-full ${badge.bg} ${badge.text}`}>
          {badge.label}
        </span>
      </div>

      {/* Talk title */}
      {talk && (
        <div className="text-xs text-[var(--text-muted)] mt-0.5">
          #{talk.talkNumber}: {talk.title}
        </div>
      )}

      {/* Duration + edit */}
      <div className="flex items-center justify-between mt-0.5">
        <span className="text-[10px] text-zinc-600">30 min</span>
        {!locked && <EditBtn onClick={onEditTalk} />}
      </div>
    </div>
  );
}

function StudyInfoBlock({
  studyWeek, conductor, reader, locked, onEdit,
}: {
  studyWeek?: WeekendMeeting["weekendStudyWeek"];
  conductor?: Assignment;
  reader?: Assignment;
  locked: boolean;
  onEdit: (id: string, slotKey: string, title: string) => void;
}) {
  if (!studyWeek) {
    return (
      <div className="px-3.5 py-2.5 text-xs text-zinc-600 italic">
        Keine Studienartikel-Daten
      </div>
    );
  }

  const conductorName = formatName(conductor?.assignee);
  const readerName = formatName(reader?.assignee);

  return (
    <div className="flex items-center gap-2.5 px-3.5 py-2 hover:bg-white/[0.02] transition-colors">
      <BookOpen size={13} className={`shrink-0 ${WEEKEND_COLORS.study.text}`} />
      <div className="flex-1 min-w-0">
        {studyWeek.articleUrl ? (
          <a
            href={studyWeek.articleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs leading-snug truncate block hover:underline cursor-pointer"
            title="In JW Library offnen"
          >
            {studyWeek.articleTitle} <ExternalLink size={9} className="inline-block mb-px opacity-40" />
          </a>
        ) : (
          <div className="text-xs leading-snug truncate">{studyWeek.articleTitle}</div>
        )}
        {studyWeek.sourceRef && (
          <div className="text-[10px] text-zinc-600 mt-px truncate">
            {studyWeek.studyNumber != null && <>Studienartikel {studyWeek.studyNumber} &middot; </>}
            {studyWeek.sourceRef}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
        <span className="text-[10px] text-zinc-600">60 min</span>
        {/* Stacked conductor + reader names */}
        <div className="flex flex-col items-end gap-px">
          <span className={`text-xs font-medium ${conductorName ? "" : "text-zinc-600 italic"}`}>
            {conductorName ?? "\u2014"}
          </span>
          <span className={`text-xs font-medium ${readerName ? "" : "text-zinc-600 italic"}`}>
            {readerName ?? "\u2014"}
          </span>
        </div>
        {!locked && conductor && (
          <EditBtn onClick={() => onEdit(conductor.id, conductor.slotTemplate.slotKey, "Wachtturm-Studium")} />
        )}
      </div>
    </div>
  );
}

/* ---- Utilities ---- */

function EditBtn({ onClick, amber }: { onClick: () => void; amber?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`text-[9px] px-1.5 py-px border border-[var(--border)] rounded-[3px] bg-transparent hover:bg-[var(--bg-2)] hover:border-[var(--border-2)] cursor-pointer leading-none ${amber ? "text-[var(--amber)]" : "text-[var(--text-muted)]"}`}
    >
      {amber ? "+" : "\u270E"}
    </button>
  );
}

function Unassigned() {
  return <span className="text-xs text-zinc-600 italic">{"\u2014"}</span>;
}

function formatName(pub?: Publisher | null): string | null {
  if (!pub) return null;
  return pub.displayName || `${pub.firstName[0]}. ${pub.lastName}`;
}
