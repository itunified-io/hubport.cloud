// hub-app/src/pages/meetings/planner/weekend/constants.ts

/** Weekend meeting section color tokens */
export const WEEKEND_COLORS = {
  talk: {
    hex: "#047857",
    bg: "bg-[#047857]/[0.04]",
    header: "bg-[#047857]",
    songBg: "bg-[#047857]/[0.08]",
    songBorder: "border-l-[#047857]",
    text: "text-[#047857]",
  },
  study: {
    hex: "#4a6da7",
    bg: "bg-[#4a6da7]/[0.04]",
    header: "bg-[#4a6da7]",
    songBg: "bg-[#4a6da7]/[0.08]",
    songBorder: "border-l-[#4a6da7]",
    text: "text-[#4a6da7]",
  },
} as const;

export type WeekendSectionKey = keyof typeof WEEKEND_COLORS;

/** Duty sidebar group colors — same as midweek */
export const DUTY_COLORS = {
  technik: { hex: "#475569", header: "bg-[#475569]" },
  ordnung: { hex: "#047857", header: "bg-[#047857]" },
  reinigung: { hex: "#92400e", header: "bg-[#92400e]" },
} as const;

/** Invitation state badge styles */
export const INVITATION_BADGES = {
  confirmed: { bg: "bg-[#14532d]", text: "text-[#86efac]", label: "Bestatigt" },
  invited: { bg: "bg-[#1e3a5f]", text: "text-[#93c5fd]", label: "Eingeladen" },
  draft: { bg: "bg-[#374151]", text: "text-[#9ca3af]", label: "Entwurf" },
} as const;

/** Weekend duty group definitions */
export const WEEKEND_DUTY_GROUPS = [
  {
    key: "technik",
    label: "Technik",
    color: "technik" as const,
    slots: ["sound", "video_pc", "microphone_1", "microphone_2", "stage", "zoom"],
  },
  {
    key: "ordnung",
    label: "Ordnungsdienst",
    color: "ordnung" as const,
    slots: ["attendant_1", "attendant_2"],
  },
  {
    key: "reinigung",
    label: "Reinigung",
    color: "reinigung" as const,
    slots: ["deep_cleaning", "spot_cleaning"],
  },
];

export const SLOT_LABELS: Record<string, string> = {
  sound: "Sound",
  video_pc: "Video / PC",
  microphone_1: "Mikrofon 1",
  microphone_2: "Mikrofon 2",
  stage: "Buhne",
  zoom: "Zoom",
  attendant_1: "Saaldiener 1",
  attendant_2: "Saaldiener 2",
  deep_cleaning: "Grundreinigung",
  spot_cleaning: "Sichtreinigung",
};
