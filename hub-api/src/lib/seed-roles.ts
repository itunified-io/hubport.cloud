/**
 * Preseeded system AppRoles — upserted on first boot.
 * These define permission bundles mapped to congregation responsibilities.
 */

import prisma from "./prisma.js";
import { PERMISSIONS } from "./permissions.js";

const P = PERMISSIONS;

interface SeedRole {
  name: string;
  description: string;
  scope: "all" | "midweek" | "weekend";
  permissions: string[];
}

const SYSTEM_ROLES: SeedRole[] = [
  {
    name: "Admin",
    description: "Hub administrator — full access, any congregation role",
    scope: "all",
    permissions: [P.WILDCARD],
  },
  {
    name: "Coordinator",
    description: "Body of elders coordinator — full access",
    scope: "all",
    permissions: [P.WILDCARD],
  },
  {
    name: "Secretary",
    description: "Congregation secretary — contacts, reports, audit",
    scope: "all",
    permissions: [
      P.PUBLISHERS_VIEW, P.PUBLISHERS_VIEW_CONTACTS, P.PUBLISHERS_EDIT,
      P.MEETINGS_VIEW, P.TERRITORIES_VIEW, P.SHARING_VIEW, P.SHARING_EDIT,
      P.SETTINGS_VIEW, P.ROLES_VIEW, P.REPORTS_VIEW, P.AUDIT_VIEW,
      P.CHAT_VIEW, P.CHAT_SEND, P.CHAT_CREATE_SPACE, P.CHAT_CROSS_TENANT,
    ],
  },
  {
    name: "Service Overseer",
    description: "Field service overseer — territories, publisher management",
    scope: "all",
    permissions: [
      P.PUBLISHERS_VIEW, P.PUBLISHERS_VIEW_CONTACTS, P.PUBLISHERS_EDIT_LIMITED,
      P.TERRITORIES_VIEW, P.TERRITORIES_EDIT, P.TERRITORIES_ASSIGN,
      P.TERRITORIES_DELETE, P.TERRITORIES_SPLIT, P.TERRITORIES_IMPORT, P.TERRITORIES_SHARE,
      P.ADDRESSES_VIEW, P.ADDRESSES_EDIT, P.ADDRESSES_IMPORT,
      P.OSM_REFRESH, P.OSM_EDIT,
      P.GAP_DETECTION_VIEW, P.GAP_DETECTION_RUN,
      P.ASSIGNMENTS_VIEW, P.ASSIGNMENTS_MANAGE,
      P.CAMPAIGNS_VIEW, P.CAMPAIGNS_MANAGE, P.CAMPAIGNS_REPORT,
      P.LOCATION_VIEW,
      P.MEETINGS_VIEW, P.SHARING_VIEW, P.SHARING_EDIT, P.REPORTS_VIEW,
      P.CHAT_VIEW, P.CHAT_SEND, P.CHAT_CROSS_TENANT,
    ],
  },
  {
    name: "LM Overseer",
    description: "Life & Ministry meeting overseer — midweek planning lifecycle owner",
    scope: "midweek",
    permissions: [
      P.MEETINGS_VIEW, P.MEETINGS_EDIT, P.MEETINGS_PUBLISH,
      P.PUBLISHERS_VIEW_MINIMAL, P.MANAGE_PROGRAM, P.MANAGE_MIDWEEK_PROGRAM,
      P.WORKBOOKS_VIEW, P.WORKBOOKS_IMPORT,
      P.MEETING_PERIODS_VIEW, P.MEETING_PERIODS_MANAGE,
      P.MEETING_ASSIGNMENTS_VIEW, P.MEETING_ASSIGNMENTS_EDIT,
    ],
  },
  {
    name: "WT Conductor",
    description: "Watchtower study conductor — weekend study planning owner",
    scope: "weekend",
    permissions: [
      P.MEETINGS_VIEW, P.MEETINGS_EDIT,
      P.PUBLISHERS_VIEW_MINIMAL, P.MANAGE_WEEKEND_PROGRAM,
      P.WEEKEND_STUDY_VIEW, P.WEEKEND_STUDY_IMPORT,
      P.MEETING_ASSIGNMENTS_VIEW, P.MEETING_ASSIGNMENTS_EDIT,
    ],
  },
  {
    name: "Public Talk Coordinator",
    description: "Public talk planning — speaker directory, talk scheduling, invitations",
    scope: "weekend",
    permissions: [
      P.MEETINGS_VIEW, P.MEETINGS_EDIT,
      P.PUBLISHERS_VIEW_MINIMAL, P.MANAGE_PUBLIC_TALKS,
      P.PUBLIC_TALKS_VIEW, P.PUBLIC_TALKS_EDIT,
      P.SPEAKERS_VIEW, P.SPEAKERS_EDIT,
      P.MEETING_ASSIGNMENTS_VIEW,
    ],
  },
  {
    name: "Technik",
    description: "Audio/video technical support",
    scope: "all",
    permissions: [
      P.PRIVILEGE_TECHNICAL_SOUND, P.PRIVILEGE_TECHNICAL_VIDEO,
      P.PRIVILEGE_TECHNICAL_MICROPHONE, P.PRIVILEGE_TECHNICAL_STAGE,
      P.MEETINGS_VIEW,
    ],
  },
  {
    name: "Ordnungsdienst",
    description: "Attendants / ushers",
    scope: "all",
    permissions: [
      P.PRIVILEGE_ATTENDANT_MIDWEEK, P.PRIVILEGE_ATTENDANT_WEEKEND,
      P.MEETINGS_VIEW,
    ],
  },
  {
    name: "Program",
    description: "All meeting participant privileges",
    scope: "all",
    permissions: [
      P.MEETINGS_VIEW, P.PUBLISHERS_VIEW_MINIMAL,
      P.PRIVILEGE_CHAIRMAN_MIDWEEK, P.PRIVILEGE_CHAIRMAN_WEEKEND,
      P.PRIVILEGE_OPENING_PRAYER, P.PRIVILEGE_CLOSING_PRAYER,
      P.PRIVILEGE_GEMS, P.PRIVILEGE_BIBLE_READING,
      P.PRIVILEGE_INITIAL_CALL, P.PRIVILEGE_RETURN_VISIT,
      P.PRIVILEGE_BIBLE_STUDY, P.PRIVILEGE_TALK,
      P.PRIVILEGE_CBS_CONDUCTOR, P.PRIVILEGE_CBS_READER,
      P.PRIVILEGE_WT_READER, P.PRIVILEGE_PUBLIC_TALK,
      P.PRIVILEGE_WT_CONDUCTOR,
      P.PRIVILEGE_PUBLIC_TALK_LOCAL, P.PRIVILEGE_SERVICE_MEETING_CONDUCTOR,
      P.PRIVILEGE_INITIAL_CALL_ASSISTANT, P.PRIVILEGE_RETURN_VISIT_ASSISTANT,
      P.PRIVILEGE_BIBLE_STUDY_ASSISTANT,
      P.PRIVILEGE_TECHNICAL_SOUND, P.PRIVILEGE_TECHNICAL_VIDEO,
      P.PRIVILEGE_TECHNICAL_MICROPHONE, P.PRIVILEGE_TECHNICAL_STAGE,
      P.PRIVILEGE_ATTENDANT_MIDWEEK, P.PRIVILEGE_ATTENDANT_WEEKEND,
    ],
  },
  // ─── Individual midweek meeting parts ────────────────────────────
  {
    name: "Vorsitzender Woche",
    description: "Midweek meeting chairman",
    scope: "midweek",
    permissions: [P.PRIVILEGE_CHAIRMAN_MIDWEEK, P.MEETINGS_VIEW],
  },
  {
    name: "Eingangsgebet",
    description: "Opening prayer",
    scope: "midweek",
    permissions: [P.PRIVILEGE_OPENING_PRAYER, P.MEETINGS_VIEW],
  },
  {
    name: "Schlussgebet",
    description: "Closing prayer",
    scope: "all",
    permissions: [P.PRIVILEGE_CLOSING_PRAYER, P.MEETINGS_VIEW],
  },
  {
    name: "Schätze",
    description: "Spiritual gems presentation",
    scope: "midweek",
    permissions: [P.PRIVILEGE_GEMS, P.MEETINGS_VIEW],
  },
  {
    name: "Bibellesung",
    description: "Bible reading",
    scope: "midweek",
    permissions: [P.PRIVILEGE_BIBLE_READING, P.MEETINGS_VIEW],
  },
  {
    name: "Erstes Gespräch",
    description: "Initial call demonstration",
    scope: "midweek",
    permissions: [P.PRIVILEGE_INITIAL_CALL, P.MEETINGS_VIEW],
  },
  {
    name: "Rückbesuch",
    description: "Return visit demonstration",
    scope: "midweek",
    permissions: [P.PRIVILEGE_RETURN_VISIT, P.MEETINGS_VIEW],
  },
  {
    name: "Bibelstudium",
    description: "Bible study demonstration",
    scope: "midweek",
    permissions: [P.PRIVILEGE_BIBLE_STUDY, P.MEETINGS_VIEW],
  },
  {
    name: "Vortrag Woche",
    description: "Midweek meeting talk",
    scope: "midweek",
    permissions: [P.PRIVILEGE_TALK, P.MEETINGS_VIEW],
  },
  {
    name: "VBS Leiter",
    description: "Congregation Bible Study conductor",
    scope: "midweek",
    permissions: [P.PRIVILEGE_CBS_CONDUCTOR, P.MEETINGS_VIEW],
  },
  {
    name: "VBS Leser",
    description: "Congregation Bible Study reader",
    scope: "midweek",
    permissions: [P.PRIVILEGE_CBS_READER, P.MEETINGS_VIEW],
  },
  // ─── Individual weekend meeting parts ──────────────────────────
  {
    name: "Vorsitzender Wochenende",
    description: "Weekend meeting chairman",
    scope: "weekend",
    permissions: [P.PRIVILEGE_CHAIRMAN_WEEKEND, P.MEETINGS_VIEW],
  },
  {
    name: "Öffentlicher Vortrag",
    description: "Public talk speaker (local only)",
    scope: "weekend",
    permissions: [P.PRIVILEGE_PUBLIC_TALK, P.PRIVILEGE_PUBLIC_TALK_LOCAL, P.MEETINGS_VIEW],
  },
  {
    name: "Gastredner",
    description: "Visiting/away speaker — available for partner congregation invitations",
    scope: "weekend",
    permissions: [P.PRIVILEGE_PUBLIC_TALK, P.PRIVILEGE_PUBLIC_TALK_VISITING, P.MEETINGS_VIEW],
  },
  {
    name: "WT Leser",
    description: "Watchtower study reader",
    scope: "weekend",
    permissions: [P.PRIVILEGE_WT_READER, P.MEETINGS_VIEW],
  },
  {
    name: "Technik Responsible",
    description: "Technical team lead — manages tech duty assignments",
    scope: "all",
    permissions: [
      P.MANAGE_TECHNIK, P.MANAGE_MEETING_DUTIES,
      P.PRIVILEGE_TECHNICAL_SOUND, P.PRIVILEGE_TECHNICAL_VIDEO,
      P.PRIVILEGE_TECHNICAL_MICROPHONE, P.PRIVILEGE_TECHNICAL_STAGE,
      P.MEETINGS_VIEW, P.PUBLISHERS_VIEW_MINIMAL,
      P.MEETING_ASSIGNMENTS_VIEW, P.MEETING_ASSIGNMENTS_EDIT,
    ],
  },
  {
    name: "Circuit Overseer",
    description: "Visiting circuit overseer — limited view, time-bound",
    scope: "all",
    permissions: [
      P.PUBLISHERS_VIEW_MINIMAL, P.MEETINGS_VIEW,
      P.DENY_ADDRESS, P.DENY_CONTACT, P.DENY_NOTES,
    ],
  },
  {
    name: "Service Overseer Assistant",
    description: "Assists with territories and publisher records",
    scope: "all",
    permissions: [
      P.PUBLISHERS_VIEW, P.PUBLISHERS_EDIT_LIMITED,
      P.TERRITORIES_VIEW, P.TERRITORIES_EDIT, P.TERRITORIES_ASSIGN,
      P.ADDRESSES_VIEW, P.ADDRESSES_EDIT,
      P.OSM_REFRESH, P.OSM_EDIT,
      P.GAP_DETECTION_VIEW, P.GAP_DETECTION_RUN,
      P.ASSIGNMENTS_VIEW, P.ASSIGNMENTS_MANAGE,
      P.CAMPAIGNS_VIEW, P.CAMPAIGNS_ASSIST, P.CAMPAIGNS_REPORT,
      P.LOCATION_VIEW,
      P.GROUPS_VIEW, P.GROUPS_EDIT,
      P.MEETINGS_VIEW,
    ],
  },
  {
    name: "Assistent Midweek",
    description: "Midweek meeting assistant / householder for student parts",
    scope: "midweek",
    permissions: [
      P.PRIVILEGE_INITIAL_CALL_ASSISTANT, P.PRIVILEGE_RETURN_VISIT_ASSISTANT,
      P.PRIVILEGE_BIBLE_STUDY_ASSISTANT, P.MEETINGS_VIEW,
    ],
  },
  {
    name: "Assistent Weekend",
    description: "Weekend meeting assistant",
    scope: "weekend",
    permissions: [P.MEETINGS_VIEW, P.PUBLISHERS_VIEW_MINIMAL],
  },
  {
    name: "Cleaning Responsible",
    description: "Kingdom Hall cleaning schedule manager",
    scope: "all",
    permissions: [
      P.MANAGE_CLEANING, P.PUBLISHERS_VIEW_MINIMAL, P.MEETINGS_VIEW,
    ],
  },
  {
    name: "Mikrofon",
    description: "Microphone runner",
    scope: "all",
    permissions: [
      P.PRIVILEGE_TECHNICAL_MICROPHONE, P.MEETINGS_VIEW,
    ],
  },
  {
    name: "Zoom Ordner",
    description: "Zoom attendant / moderator",
    scope: "all",
    permissions: [
      P.PRIVILEGE_ZOOM_MODERATOR, P.PRIVILEGE_TECHNICAL_VIDEO, P.MEETINGS_VIEW,
    ],
  },
  {
    name: "Video PC",
    description: "Video / presentation PC operator",
    scope: "all",
    permissions: [
      P.PRIVILEGE_TECHNICAL_VIDEO, P.PRIVILEGE_TECHNICAL_STAGE, P.MEETINGS_VIEW,
    ],
  },
  {
    name: "Audio Anlage",
    description: "Sound system operator",
    scope: "all",
    permissions: [
      P.PRIVILEGE_TECHNICAL_SOUND, P.MEETINGS_VIEW,
    ],
  },
  {
    name: "Sound",
    description: "Sound mixing",
    scope: "all",
    permissions: [
      P.PRIVILEGE_TECHNICAL_SOUND, P.MEETINGS_VIEW,
    ],
  },
  {
    name: "Vortragsplaner",
    description: "Public talk planner / scheduler (German alias for Public Talk Coordinator)",
    scope: "weekend",
    permissions: [
      P.MANAGE_PROGRAM, P.MANAGE_PUBLIC_TALKS,
      P.PRIVILEGE_PUBLIC_TALK, P.PUBLISHERS_VIEW_MINIMAL, P.MEETINGS_VIEW,
      P.PUBLIC_TALKS_VIEW, P.PUBLIC_TALKS_EDIT,
      P.SPEAKERS_VIEW, P.SPEAKERS_EDIT,
    ],
  },
  {
    name: "Grundreinigung",
    description: "Deep cleaning team member",
    scope: "all",
    permissions: [P.PRIVILEGE_CLEANING_DEEP, P.CLEANING_VIEW],
  },
  {
    name: "Sichtreinigung",
    description: "Visual / spot cleaning team member",
    scope: "all",
    permissions: [P.PRIVILEGE_CLEANING_VISUAL, P.CLEANING_VIEW],
  },
  {
    name: "Rasen",
    description: "Lawn care team member",
    scope: "all",
    permissions: [P.PRIVILEGE_GARDEN_LAWN, P.CLEANING_VIEW],
  },
  {
    name: "Winterdienst",
    description: "Snow clearing / winter service team member",
    scope: "all",
    permissions: [P.PRIVILEGE_GARDEN_WINTER, P.CLEANING_VIEW],
  },
];

/**
 * Upsert all system roles. Safe to call multiple times.
 */
export async function seedSystemRoles(): Promise<void> {
  for (const role of SYSTEM_ROLES) {
    await prisma.appRole.upsert({
      where: { name: role.name },
      update: {
        description: role.description,
        permissions: role.permissions,
        scope: role.scope,
        isSystem: true,
      },
      create: {
        name: role.name,
        description: role.description,
        permissions: role.permissions,
        scope: role.scope,
        isSystem: true,
      },
    });
  }
}
