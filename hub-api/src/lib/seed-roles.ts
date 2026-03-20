/**
 * Seed 12 system AppRoles on first boot.
 *
 * Uses upsert — safe to call multiple times.
 */

import type { PrismaClient } from "@prisma/client";
import { PERMISSIONS, DENY_KEYS, PRIVILEGES } from "./permissions.js";

const P = PERMISSIONS;
const D = DENY_KEYS;
const PR = PRIVILEGES;

interface SeedRole {
  name: string;
  description: string;
  permissions: string[];
  scope: "all" | "midweek" | "weekend";
}

const SYSTEM_ROLES: SeedRole[] = [
  {
    name: "Coordinator",
    description: "Body of Elders coordinator — full access",
    permissions: [P.WILDCARD],
    scope: "all",
  },
  {
    name: "Secretary",
    description: "Congregation secretary — contacts, reports, audit",
    permissions: [
      P.PUBLISHERS_VIEW, P.PUBLISHERS_VIEW_CONTACTS, P.PUBLISHERS_EDIT,
      P.PUBLISHERS_EDIT_SENSITIVE, P.PUBLISHERS_INVITE,
      P.MEETINGS_VIEW, P.TERRITORIES_VIEW,
      P.ROLES_VIEW, P.REPORTS_VIEW, P.AUDIT_VIEW,
      P.SETTINGS_VIEW,
    ],
    scope: "all",
  },
  {
    name: "Service Overseer",
    description: "Territory and field service management",
    permissions: [
      P.PUBLISHERS_VIEW, P.PUBLISHERS_EDIT_LIMITED,
      P.TERRITORIES_VIEW, P.TERRITORIES_EDIT, P.TERRITORIES_ASSIGN,
      P.TERRITORIES_SHARE, P.TERRITORIES_DELETE,
      P.MEETINGS_VIEW, P.REPORTS_VIEW,
    ],
    scope: "all",
  },
  {
    name: "LM Overseer",
    description: "Life and Ministry meeting overseer",
    permissions: [
      P.MEETINGS_VIEW, P.MEETINGS_MIDWEEK_VIEW, P.MEETINGS_EDIT,
      P.PUBLISHERS_VIEW_MINIMAL, P.MANAGE_PROGRAM,
    ],
    scope: "midweek",
  },
  {
    name: "WT Conductor",
    description: "Watchtower Study conductor",
    permissions: [
      P.MEETINGS_VIEW, P.MEETINGS_WEEKEND_VIEW, P.MEETINGS_EDIT,
      P.PUBLISHERS_VIEW_MINIMAL,
    ],
    scope: "weekend",
  },
  {
    name: "Technik",
    description: "Sound, video, and stage duties",
    permissions: [
      PR.TECHNICAL_SOUND, PR.TECHNICAL_VIDEO,
      PR.TECHNICAL_MICROPHONE, PR.TECHNICAL_STAGE,
      P.MEETINGS_VIEW,
    ],
    scope: "all",
  },
  {
    name: "Ordnungsdienst",
    description: "Attendant and parking duties",
    permissions: [
      PR.ATTENDANT_MIDWEEK, PR.ATTENDANT_WEEKEND, PR.ATTENDANT_PARKING,
      P.MEETINGS_VIEW,
    ],
    scope: "all",
  },
  {
    name: "Program",
    description: "All meeting participant privileges",
    permissions: [
      P.MEETINGS_VIEW,
      PR.CHAIRMAN_MIDWEEK, PR.OPENING_PRAYER_MIDWEEK, PR.CLOSING_PRAYER_MIDWEEK,
      PR.TREASURES_TALK, PR.TREASURES_DIGGING, PR.BIBLE_READING,
      PR.INITIAL_CALL, PR.RETURN_VISIT, PR.BIBLE_STUDY_DEMO,
      PR.STUDENT_TALK, PR.APPLY_YOURSELF_ASSISTANT,
      PR.CBS_CONDUCTOR, PR.CBS_READER, PR.LIVING_AS_CHRISTIANS_TALK,
      PR.CHAIRMAN_WEEKEND, PR.OPENING_PRAYER_WEEKEND, PR.CLOSING_PRAYER_WEEKEND,
      PR.PUBLIC_SPEAKER, PR.WATCHTOWER_CONDUCTOR, PR.WATCHTOWER_READER,
    ],
    scope: "all",
  },
  {
    name: "Technik Responsible",
    description: "Manages technical team assignments",
    permissions: [
      P.MANAGE_TECHNIK,
      PR.TECHNICAL_SOUND, PR.TECHNICAL_VIDEO,
      PR.TECHNICAL_MICROPHONE, PR.TECHNICAL_STAGE,
      P.MEETINGS_VIEW, P.PUBLISHERS_VIEW_MINIMAL,
    ],
    scope: "all",
  },
  {
    name: "Circuit Overseer",
    description: "Visiting circuit overseer — limited view, no personal data",
    permissions: [
      P.PUBLISHERS_VIEW_MINIMAL, P.MEETINGS_VIEW,
      D.PUBLISHERS_ADDRESS, D.PUBLISHERS_CONTACT, D.PUBLISHERS_NOTES,
    ],
    scope: "all",
  },
  {
    name: "Service Overseer Assistant",
    description: "Assists with territory and publisher management",
    permissions: [
      P.PUBLISHERS_VIEW, P.PUBLISHERS_EDIT_LIMITED,
      P.TERRITORIES_VIEW, P.TERRITORIES_EDIT, P.TERRITORIES_ASSIGN,
      P.MEETINGS_VIEW,
    ],
    scope: "all",
  },
  {
    name: "Cleaning Responsible",
    description: "Manages cleaning schedule",
    permissions: [P.MANAGE_CLEANING, P.PUBLISHERS_VIEW_MINIMAL, P.MEETINGS_VIEW],
    scope: "all",
  },
];

export async function seedSystemRoles(prisma: PrismaClient): Promise<number> {
  let created = 0;

  for (const role of SYSTEM_ROLES) {
    await prisma.appRole.upsert({
      where: { name: role.name },
      update: {
        description: role.description,
        permissions: role.permissions,
        scope: role.scope,
      },
      create: {
        name: role.name,
        description: role.description,
        permissions: role.permissions,
        scope: role.scope,
        isSystem: true,
      },
    });
    created++;
  }

  return created;
}
