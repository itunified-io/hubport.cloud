// hub-app/src/pages/meetings/planner/midweek/ProgramCard.tsx
import {
  Mic, Star, BookOpen, Users, Music, HandHelping,
} from "lucide-react";
import { SECTION_COLORS, type SectionKey } from "./constants";
import type { PeriodMeeting, Assignment, Publisher } from "./types";

interface ProgramCardProps {
  meeting: PeriodMeeting;
  locked: boolean;
  onEditAssignment: (assignmentId: string, slotKey: string, title: string) => void;
}

export function ProgramCard({ meeting, locked, onEditAssignment }: ProgramCardProps) {
  const songs = meeting.workbookWeek?.songNumbers ?? [];
  const assignments = meeting.assignments ?? [];

  // Find chairman assignment (slot key includes meeting type suffix)
  const chairman = assignments.find((a) => a.slotTemplate.slotKey.startsWith("chairman"));
  const chairmanName = formatName(chairman?.assignee);

  // Find prayer assignments
  const openingPrayer = assignments.find((a) => a.slotTemplate.slotKey.startsWith("opening_prayer"));
  const closingPrayer = assignments.find((a) => a.slotTemplate.slotKey.startsWith("closing_prayer"));

  // Group program assignments by section
  const programBySection = groupBySection(assignments);

  return (
    <div className="rounded-[var(--radius)] overflow-hidden border border-[var(--border)] bg-[var(--bg-1)] shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
      {/* Chairman — always first, amber tint */}
      <ChairmanRow assignment={chairman} locked={locked} onEdit={onEditAssignment} />

      {/* Opening song */}
      {songs[0] != null && <SongBar number={songs[0]} section="treasures" />}

      {/* Prayer + opening comments */}
      <PrayerRow label="Gebet · Einleitende Worte" name={chairmanName} duration={1} auto assignment={openingPrayer} locked={locked} onEdit={onEditAssignment} />

      {/* SCHATZE AUS GOTTES WORT */}
      <SectionBlock
        section="treasures"
        assignments={programBySection.treasures}
        locked={locked}
        onEdit={onEditAssignment}
      />

      {/* UNS IM DIENST VERBESSERN */}
      <SectionBlock
        section="ministry"
        assignments={programBySection.ministry}
        locked={locked}
        onEdit={onEditAssignment}
      />

      {/* Middle song */}
      {songs[1] != null && <SongBar number={songs[1]} section="living" />}

      {/* UNSER LEBEN ALS CHRIST */}
      <SectionBlock
        section="living"
        assignments={programBySection.living}
        locked={locked}
        onEdit={onEditAssignment}
      />

      {/* Closing comments */}
      <PrayerRow label="Schlussworte" name={chairmanName} duration={3} auto />

      {/* Closing song */}
      {songs[2] != null && <SongBar number={songs[2]} section="living" />}

      {/* Closing prayer */}
      <PrayerRow
        label="Schlussgebet"
        name={formatName(closingPrayer?.assignee)}
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
  assignment?: Assignment; locked: boolean;
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

function SongBar({ number, section }: { number: number; section: SectionKey }) {
  const colors = SECTION_COLORS[section];
  return (
    <div className={`flex items-center gap-2.5 px-3.5 py-[7px] border-l-[3px] ${colors.songBorder} ${colors.songBg} ${colors.text}`}>
      <Music size={13} className="shrink-0" />
      <span className="text-xs font-medium">Lied {number}</span>
    </div>
  );
}

function PrayerRow({
  label, name, duration, auto, assignment, locked, onEdit,
}: {
  label: string; name?: string | null; duration?: number; auto?: boolean;
  assignment?: Assignment; locked?: boolean;
  onEdit?: (id: string, slotKey: string, title: string) => void;
}) {
  return (
    <div className="flex items-center gap-2.5 px-3.5 py-1.5 bg-white/[0.015]">
      <HandHelping size={12} className="shrink-0 text-zinc-600" />
      <span className="text-xs text-[var(--text-muted)] flex-1">{label}</span>
      {duration && <span className="text-[10px] text-zinc-600 mr-1">{duration} min</span>}
      {name ? (
        <span className={`text-xs font-medium ${auto ? "opacity-50 italic" : ""}`}>{name}</span>
      ) : (
        <Unassigned />
      )}
      {!locked && assignment && onEdit && (
        <EditBtn onClick={() => onEdit(assignment.id, assignment.slotTemplate.slotKey, label)} />
      )}
    </div>
  );
}

function SectionBlock({
  section, assignments, locked, onEdit,
}: {
  section: SectionKey; assignments: Assignment[]; locked: boolean;
  onEdit: (id: string, slotKey: string, title: string) => void;
}) {
  const colors = SECTION_COLORS[section];
  const label = section === "treasures" ? "Schätze aus Gottes Wort"
    : section === "ministry" ? "Uns im Dienst verbessern"
    : "Unser Leben als Christ";

  if (assignments.length === 0) return null;

  return (
    <>
      {/* Section header */}
      <div className={`px-3.5 py-1.5 ${colors.header}`}>
        <span className="text-[10px] font-bold uppercase tracking-[1px] text-white/95">{label}</span>
      </div>
      {/* Section body */}
      <div className={colors.bg}>
        {assignments.map((a, i) => (
          <PartRow key={a.id} assignment={a} section={section} showBorder={i > 0} locked={locked} onEdit={onEdit} />
        ))}
      </div>
    </>
  );
}

function PartRow({
  assignment, section, showBorder, locked, onEdit,
}: {
  assignment: Assignment; section: SectionKey; showBorder: boolean; locked: boolean;
  onEdit: (id: string, slotKey: string, title: string) => void;
}) {
  const colors = SECTION_COLORS[section];
  const part = assignment.workbookPart;
  const title = part?.title ?? assignment.slotTemplate.label;
  const subtitle = part?.subtitle;
  const duration = part?.durationMinutes;
  const hasAssistant = part?.requiresAssistant;
  const name = formatName(assignment.assignee);
  const assistantName = formatName(assignment.assistant);
  const Icon = getPartIcon(part?.partType);

  return (
    <div className={`flex items-center gap-2.5 px-3.5 py-2 hover:bg-white/[0.02] transition-colors ${showBorder ? "border-t border-white/[0.03]" : ""}`}>
      <Icon size={13} className={`shrink-0 ${colors.text}`} />
      <div className="flex-1 min-w-0">
        <div className="text-xs leading-snug truncate">{title}</div>
        {subtitle && <div className="text-[10px] text-zinc-600 mt-px">{subtitle}</div>}
      </div>
      <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
        {duration && <span className="text-[10px] text-zinc-600">{duration} min</span>}
        {hasAssistant ? (
          <div className="flex flex-col items-end gap-px">
            <span className={`text-xs font-medium ${name ? "" : "text-zinc-600 italic"}`}>{name ?? "—"}</span>
            <span className={`text-xs font-medium ${assistantName ? "" : "text-zinc-600 italic"}`}>{assistantName ?? "—"}</span>
          </div>
        ) : (
          <span className={`text-xs font-medium ${name ? "" : "text-zinc-600 italic"}`}>{name ?? "—"}</span>
        )}
        {!locked && (
          <EditBtn
            amber={!name}
            onClick={() => onEdit(assignment.id, assignment.slotTemplate.slotKey, title)}
          />
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
      {amber ? "+" : "✎"}
    </button>
  );
}

function Unassigned() {
  return <span className="text-xs text-zinc-600 italic">—</span>;
}

function formatName(pub?: Publisher | null): string | null {
  if (!pub) return null;
  return pub.displayName || `${pub.firstName[0]}. ${pub.lastName}`;
}

function getPartIcon(partType?: string) {
  switch (partType) {
    case "talk": case "discussion": return Mic;
    case "gems": return Star;
    case "bible_reading": case "cbs": return BookOpen;
    case "student_demo": return Users;
    default: return Mic;
  }
}

/** Slot keys handled explicitly in ProgramCard layout — exclude from section grouping */
const EXPLICIT_SLOTS = new Set(["chairman_midweek", "chairman_weekend", "opening_prayer_midweek", "opening_prayer_weekend", "closing_prayer_midweek", "closing_prayer_weekend"]);

function groupBySection(assignments: Assignment[]) {
  const result: Record<SectionKey, Assignment[]> = { treasures: [], ministry: [], living: [] };
  for (const a of assignments) {
    if (a.slotTemplate.category !== "program") continue;
    if (EXPLICIT_SLOTS.has(a.slotTemplate.slotKey)) continue;
    const sec = (a.workbookPart?.section ?? "treasures") as SectionKey;
    if (result[sec]) result[sec].push(a);
  }
  // Sort by slotTemplate.sortOrder within each section
  for (const sec of Object.keys(result) as SectionKey[]) {
    result[sec].sort((a, b) => a.slotTemplate.sortOrder - b.slotTemplate.sortOrder);
  }
  return result;
}
