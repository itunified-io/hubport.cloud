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
      P.MEETINGS_VIEW, P.TERRITORIES_VIEW,
      P.SETTINGS_VIEW, P.ROLES_VIEW, P.REPORTS_VIEW, P.AUDIT_VIEW,
    ],
  },
  {
    name: "Service Overseer",
    description: "Field service overseer — territories, publisher management",
    scope: "all",
    permissions: [
      P.PUBLISHERS_VIEW, P.PUBLISHERS_VIEW_CONTACTS, P.PUBLISHERS_EDIT_LIMITED,
      P.TERRITORIES_VIEW, P.TERRITORIES_EDIT, P.TERRITORIES_ASSIGN,
      P.MEETINGS_VIEW, P.REPORTS_VIEW,
    ],
  },
  {
    name: "LM Overseer",
    description: "Life & Ministry meeting overseer",
    scope: "midweek",
    permissions: [
      P.MEETINGS_VIEW, P.MEETINGS_EDIT, P.MEETINGS_PUBLISH,
      P.PUBLISHERS_VIEW_MINIMAL, P.MANAGE_PROGRAM,
    ],
  },
  {
    name: "WT Conductor",
    description: "Watchtower study conductor",
    scope: "weekend",
    permissions: [
      P.MEETINGS_VIEW, P.MEETINGS_EDIT,
      P.PUBLISHERS_VIEW_MINIMAL,
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
      P.PRIVILEGE_TECHNICAL_SOUND, P.PRIVILEGE_TECHNICAL_VIDEO,
      P.PRIVILEGE_TECHNICAL_MICROPHONE, P.PRIVILEGE_TECHNICAL_STAGE,
      P.PRIVILEGE_ATTENDANT_MIDWEEK, P.PRIVILEGE_ATTENDANT_WEEKEND,
    ],
  },
  {
    name: "Technik Responsible",
    description: "Technical team lead — manages tech assignments",
    scope: "all",
    permissions: [
      P.MANAGE_TECHNIK,
      P.PRIVILEGE_TECHNICAL_SOUND, P.PRIVILEGE_TECHNICAL_VIDEO,
      P.PRIVILEGE_TECHNICAL_MICROPHONE, P.PRIVILEGE_TECHNICAL_STAGE,
      P.MEETINGS_VIEW, P.PUBLISHERS_VIEW_MINIMAL,
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
      P.MEETINGS_VIEW,
    ],
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
    description: "Public talk planner / scheduler",
    scope: "weekend",
    permissions: [
      P.MANAGE_PROGRAM, P.PRIVILEGE_PUBLIC_TALK, P.PUBLISHERS_VIEW_MINIMAL, P.MEETINGS_VIEW,
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
 * Upsert all 22 system roles. Safe to call multiple times.
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
