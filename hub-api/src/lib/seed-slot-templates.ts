/**
 * Seed canonical meeting slot templates.
 * These define all possible assignment positions for midweek and weekend meetings.
 * Upserted on startup — safe to call multiple times.
 */

import prisma from "./prisma.js";
import { PERMISSIONS } from "./permissions.js";

const P = PERMISSIONS;

interface SlotTemplate {
  slotKey: string;
  label: string;
  meetingType: "midweek" | "weekend" | "all";
  category: "program" | "duty";
  requiredPrivileges: string[];
  allowsAssistant: boolean;
  requiresAssistant: boolean;
  sortOrder: number;
}

const SLOT_TEMPLATES: SlotTemplate[] = [
  // ─── Midweek Program Parts ──────────────────────────────────────
  {
    slotKey: "chairman_midweek",
    label: "Chairman (Midweek)",
    meetingType: "midweek",
    category: "program",
    requiredPrivileges: [P.PRIVILEGE_CHAIRMAN_MIDWEEK],
    allowsAssistant: false,
    requiresAssistant: false,
    sortOrder: 1,
  },
  {
    slotKey: "opening_prayer_midweek",
    label: "Opening Prayer (Midweek)",
    meetingType: "midweek",
    category: "program",
    requiredPrivileges: [P.PRIVILEGE_OPENING_PRAYER],
    allowsAssistant: false,
    requiresAssistant: false,
    sortOrder: 2,
  },
  {
    slotKey: "gems",
    label: "Spiritual Gems",
    meetingType: "midweek",
    category: "program",
    requiredPrivileges: [P.PRIVILEGE_GEMS],
    allowsAssistant: false,
    requiresAssistant: false,
    sortOrder: 10,
  },
  {
    slotKey: "bible_reading",
    label: "Bible Reading",
    meetingType: "midweek",
    category: "program",
    requiredPrivileges: [P.PRIVILEGE_BIBLE_READING],
    allowsAssistant: false,
    requiresAssistant: false,
    sortOrder: 11,
  },
  {
    slotKey: "initial_call",
    label: "Initial Call",
    meetingType: "midweek",
    category: "program",
    requiredPrivileges: [P.PRIVILEGE_INITIAL_CALL],
    allowsAssistant: true,
    requiresAssistant: true,
    sortOrder: 20,
  },
  {
    slotKey: "return_visit",
    label: "Return Visit",
    meetingType: "midweek",
    category: "program",
    requiredPrivileges: [P.PRIVILEGE_RETURN_VISIT],
    allowsAssistant: true,
    requiresAssistant: true,
    sortOrder: 21,
  },
  {
    slotKey: "bible_study_demo",
    label: "Bible Study",
    meetingType: "midweek",
    category: "program",
    requiredPrivileges: [P.PRIVILEGE_BIBLE_STUDY],
    allowsAssistant: true,
    requiresAssistant: true,
    sortOrder: 22,
  },
  {
    slotKey: "talk_midweek",
    label: "Talk (Midweek)",
    meetingType: "midweek",
    category: "program",
    requiredPrivileges: [P.PRIVILEGE_TALK],
    allowsAssistant: false,
    requiresAssistant: false,
    sortOrder: 23,
  },
  {
    slotKey: "cbs_conductor",
    label: "Congregation Bible Study Conductor",
    meetingType: "midweek",
    category: "program",
    requiredPrivileges: [P.PRIVILEGE_CBS_CONDUCTOR],
    allowsAssistant: false,
    requiresAssistant: false,
    sortOrder: 30,
  },
  {
    slotKey: "cbs_reader",
    label: "Congregation Bible Study Reader",
    meetingType: "midweek",
    category: "program",
    requiredPrivileges: [P.PRIVILEGE_CBS_READER],
    allowsAssistant: false,
    requiresAssistant: false,
    sortOrder: 31,
  },
  {
    slotKey: "closing_prayer_midweek",
    label: "Closing Prayer (Midweek)",
    meetingType: "midweek",
    category: "program",
    requiredPrivileges: [P.PRIVILEGE_CLOSING_PRAYER],
    allowsAssistant: false,
    requiresAssistant: false,
    sortOrder: 40,
  },

  // ─── Weekend Program Parts ──────────────────────────────────────
  {
    slotKey: "chairman_weekend",
    label: "Chairman (Weekend)",
    meetingType: "weekend",
    category: "program",
    requiredPrivileges: [P.PRIVILEGE_CHAIRMAN_WEEKEND],
    allowsAssistant: false,
    requiresAssistant: false,
    sortOrder: 1,
  },
  {
    slotKey: "opening_prayer_weekend",
    label: "Opening Prayer (Weekend)",
    meetingType: "weekend",
    category: "program",
    requiredPrivileges: [P.PRIVILEGE_OPENING_PRAYER],
    allowsAssistant: false,
    requiresAssistant: false,
    sortOrder: 2,
  },
  {
    slotKey: "public_talk",
    label: "Public Talk",
    meetingType: "weekend",
    category: "program",
    requiredPrivileges: [P.PRIVILEGE_PUBLIC_TALK],
    allowsAssistant: false,
    requiresAssistant: false,
    sortOrder: 10,
  },
  {
    slotKey: "wt_conductor",
    label: "Watchtower Study Conductor",
    meetingType: "weekend",
    category: "program",
    requiredPrivileges: [P.PRIVILEGE_WT_CONDUCTOR],
    allowsAssistant: false,
    requiresAssistant: false,
    sortOrder: 20,
  },
  {
    slotKey: "wt_reader",
    label: "Watchtower Study Reader",
    meetingType: "weekend",
    category: "program",
    requiredPrivileges: [P.PRIVILEGE_WT_READER],
    allowsAssistant: false,
    requiresAssistant: false,
    sortOrder: 21,
  },
  {
    slotKey: "closing_prayer_weekend",
    label: "Closing Prayer (Weekend)",
    meetingType: "weekend",
    category: "program",
    requiredPrivileges: [P.PRIVILEGE_CLOSING_PRAYER],
    allowsAssistant: false,
    requiresAssistant: false,
    sortOrder: 30,
  },

  // ─── Operational Duties (both meeting types) ────────────────────
  {
    slotKey: "sound",
    label: "Sound",
    meetingType: "all",
    category: "duty",
    requiredPrivileges: [P.PRIVILEGE_TECHNICAL_SOUND],
    allowsAssistant: false,
    requiresAssistant: false,
    sortOrder: 100,
  },
  {
    slotKey: "video",
    label: "Video / Presentation PC",
    meetingType: "all",
    category: "duty",
    requiredPrivileges: [P.PRIVILEGE_TECHNICAL_VIDEO],
    allowsAssistant: false,
    requiresAssistant: false,
    sortOrder: 101,
  },
  {
    slotKey: "microphone_1",
    label: "Microphone 1",
    meetingType: "all",
    category: "duty",
    requiredPrivileges: [P.PRIVILEGE_TECHNICAL_MICROPHONE],
    allowsAssistant: false,
    requiresAssistant: false,
    sortOrder: 102,
  },
  {
    slotKey: "microphone_2",
    label: "Microphone 2",
    meetingType: "all",
    category: "duty",
    requiredPrivileges: [P.PRIVILEGE_TECHNICAL_MICROPHONE],
    allowsAssistant: false,
    requiresAssistant: false,
    sortOrder: 103,
  },
  {
    slotKey: "stage",
    label: "Stage / Platform",
    meetingType: "all",
    category: "duty",
    requiredPrivileges: [P.PRIVILEGE_TECHNICAL_STAGE],
    allowsAssistant: false,
    requiresAssistant: false,
    sortOrder: 104,
  },
  {
    slotKey: "attendant_1",
    label: "Attendant 1",
    meetingType: "all",
    category: "duty",
    requiredPrivileges: [P.PRIVILEGE_ATTENDANT_MIDWEEK, P.PRIVILEGE_ATTENDANT_WEEKEND],
    allowsAssistant: false,
    requiresAssistant: false,
    sortOrder: 110,
  },
  {
    slotKey: "attendant_2",
    label: "Attendant 2",
    meetingType: "all",
    category: "duty",
    requiredPrivileges: [P.PRIVILEGE_ATTENDANT_MIDWEEK, P.PRIVILEGE_ATTENDANT_WEEKEND],
    allowsAssistant: false,
    requiresAssistant: false,
    sortOrder: 111,
  },
  {
    slotKey: "zoom_moderator",
    label: "Zoom Moderator",
    meetingType: "all",
    category: "duty",
    requiredPrivileges: [P.PRIVILEGE_ZOOM_MODERATOR],
    allowsAssistant: false,
    requiresAssistant: false,
    sortOrder: 120,
  },
];

/**
 * Upsert all slot templates. Safe to call multiple times.
 */
export async function seedSlotTemplates(): Promise<void> {
  for (const template of SLOT_TEMPLATES) {
    await prisma.meetingSlotTemplate.upsert({
      where: { slotKey: template.slotKey },
      update: {
        label: template.label,
        meetingType: template.meetingType,
        category: template.category,
        requiredPrivileges: template.requiredPrivileges,
        allowsAssistant: template.allowsAssistant,
        requiresAssistant: template.requiresAssistant,
        sortOrder: template.sortOrder,
        isActive: true,
      },
      create: {
        slotKey: template.slotKey,
        label: template.label,
        meetingType: template.meetingType,
        category: template.category,
        requiredPrivileges: template.requiredPrivileges,
        allowsAssistant: template.allowsAssistant,
        requiresAssistant: template.requiresAssistant,
        sortOrder: template.sortOrder,
        isActive: true,
      },
    });
  }
}
