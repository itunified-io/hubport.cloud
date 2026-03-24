// hub-app/src/pages/meetings/planner/midweek/constants.ts

/** JW.org official meeting section color tokens */
export const SECTION_COLORS = {
  treasures: {
    hex: "#4a6da7",
    bg: "bg-[#4a6da7]/[0.04]",
    header: "bg-[#4a6da7]",
    songBg: "bg-[#4a6da7]/[0.08]",
    songBorder: "border-l-[#4a6da7]",
    text: "text-[#4a6da7]",
  },
  ministry: {
    hex: "#c18626",
    bg: "bg-[#c18626]/[0.04]",
    header: "bg-[#c18626]",
    songBg: "bg-[#c18626]/[0.08]",
    songBorder: "border-l-[#c18626]",
    text: "text-[#c18626]",
  },
  living: {
    hex: "#961526",
    bg: "bg-[#961526]/[0.04]",
    header: "bg-[#961526]",
    songBg: "bg-[#961526]/[0.08]",
    songBorder: "border-l-[#961526]",
    text: "text-[#961526]",
  },
} as const;

export type SectionKey = keyof typeof SECTION_COLORS;

export const SECTION_LABELS: Record<SectionKey, string> = {
  treasures: "Schätze aus Gottes Wort",
  ministry: "Uns im Dienst verbessern",
  living: "Unser Leben als Christ",
};

/** Duty sidebar group colors */
export const DUTY_COLORS = {
  technik: { hex: "#475569", header: "bg-[#475569]" },
  ordnung: { hex: "#047857", header: "bg-[#047857]" },
  reinigung: { hex: "#92400e", header: "bg-[#92400e]" },
} as const;

/** Maps part types to Lucide icon names for programmatic rendering */
export const PART_ICON_MAP: Record<string, string> = {
  talk: "mic",
  gems: "star",
  bible_reading: "book-open",
  student_demo: "users",
  discussion: "mic",
  cbs: "book-open",
};
