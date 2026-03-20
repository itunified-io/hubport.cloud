/**
 * Permission constants and role-to-permission mappings.
 *
 * Permission key format: <namespace>:<resource>.<action>
 * Deny keys:            deny:<resource>.<field>
 * Privilege keys:       privilege:<name>
 * Management keys:      manage:<area>
 */

// --- Permission Keys ---

export const PERMISSIONS = {
  // Publishers
  PUBLISHERS_VIEW: "app:publishers.view",
  PUBLISHERS_VIEW_MINIMAL: "app:publishers.view_minimal",
  PUBLISHERS_VIEW_CONTACTS: "app:publishers.view_contacts",
  PUBLISHERS_EDIT: "app:publishers.edit",
  PUBLISHERS_EDIT_LIMITED: "app:publishers.edit_limited",
  PUBLISHERS_EDIT_SENSITIVE: "app:publishers.edit_sensitive",
  PUBLISHERS_DELETE: "app:publishers.delete",
  PUBLISHERS_INVITE: "app:publishers.invite",

  // Meetings
  MEETINGS_VIEW: "app:meetings.view",
  MEETINGS_MIDWEEK_VIEW: "app:meetings.midweek.view",
  MEETINGS_WEEKEND_VIEW: "app:meetings.weekend.view",
  MEETINGS_EDIT: "app:meetings.edit",
  MEETINGS_PUBLISH: "app:meetings.publish",

  // Territories
  TERRITORIES_VIEW: "app:territories.view",
  TERRITORIES_EDIT: "app:territories.edit",
  TERRITORIES_DELETE: "app:territories.delete",
  TERRITORIES_ASSIGN: "app:territories.assign",
  TERRITORIES_SHARE: "app:territories.share",

  // Settings
  SETTINGS_VIEW: "app:settings.view",
  SETTINGS_EDIT: "app:settings.edit",

  // Admin
  ROLES_VIEW: "app:roles.view",
  ROLES_EDIT: "app:roles.edit",
  AUDIT_VIEW: "app:audit.view",
  REPORTS_VIEW: "app:reports.view",

  // Management
  MANAGE_ALL: "manage:all",
  MANAGE_TECHNIK: "manage:technik",
  MANAGE_ORDNUNGSDIENST: "manage:ordnungsdienst",
  MANAGE_PROGRAM: "manage:program",
  MANAGE_CLEANING: "manage:cleaning",

  // Wildcard
  WILDCARD: "*",
} as const;

// --- Deny Keys ---

export const DENY_KEYS = {
  PUBLISHERS_ADDRESS: "deny:publishers.address",
  PUBLISHERS_CONTACT: "deny:publishers.contact",
  PUBLISHERS_NOTES: "deny:publishers.notes",
} as const;

// --- Privilege Keys (meeting participant duties) ---

export const PRIVILEGES = {
  // Midweek
  CHAIRMAN_MIDWEEK: "privilege:chairmanMidweek",
  OPENING_PRAYER_MIDWEEK: "privilege:openingPrayerMidweek",
  CLOSING_PRAYER_MIDWEEK: "privilege:closingPrayerMidweek",
  TREASURES_TALK: "privilege:treasuresTalk",
  TREASURES_DIGGING: "privilege:treasuresDigging",
  BIBLE_READING: "privilege:bibleReading",
  INITIAL_CALL: "privilege:initialCall",
  RETURN_VISIT: "privilege:returnVisit",
  BIBLE_STUDY_DEMO: "privilege:bibleStudyDemo",
  STUDENT_TALK: "privilege:studentTalk",
  APPLY_YOURSELF_ASSISTANT: "privilege:applyYourselfAssistant",
  CBS_CONDUCTOR: "privilege:cbsConductor",
  CBS_READER: "privilege:cbsReader",
  LIVING_AS_CHRISTIANS_TALK: "privilege:livingAsChristiansTalk",

  // Weekend
  CHAIRMAN_WEEKEND: "privilege:chairmanWeekend",
  OPENING_PRAYER_WEEKEND: "privilege:openingPrayerWeekend",
  CLOSING_PRAYER_WEEKEND: "privilege:closingPrayerWeekend",
  PUBLIC_SPEAKER: "privilege:publicSpeaker",
  WATCHTOWER_CONDUCTOR: "privilege:watchtowerConductor",
  WATCHTOWER_READER: "privilege:watchtowerReader",

  // Technical
  TECHNICAL_SOUND: "privilege:technicalSound",
  TECHNICAL_VIDEO: "privilege:technicalVideo",
  TECHNICAL_MICROPHONE: "privilege:technicalMicrophone",
  TECHNICAL_STAGE: "privilege:technicalStage",

  // Attendant
  ATTENDANT_MIDWEEK: "privilege:attendantMidweek",
  ATTENDANT_WEEKEND: "privilege:attendantWeekend",
  ATTENDANT_PARKING: "privilege:attendantParking",
} as const;

// --- Keycloak Role → Base Permissions ---

export const KEYCLOAK_BASE_PERMISSIONS: Record<string, string[]> = {
  admin: [PERMISSIONS.WILDCARD],
  elder: [
    PERMISSIONS.PUBLISHERS_VIEW,
    PERMISSIONS.PUBLISHERS_VIEW_CONTACTS,
    PERMISSIONS.PUBLISHERS_EDIT,
    PERMISSIONS.PUBLISHERS_INVITE,
    PERMISSIONS.MEETINGS_VIEW,
    PERMISSIONS.MEETINGS_EDIT,
    PERMISSIONS.MEETINGS_PUBLISH,
    PERMISSIONS.TERRITORIES_VIEW,
    PERMISSIONS.TERRITORIES_EDIT,
    PERMISSIONS.TERRITORIES_ASSIGN,
    PERMISSIONS.TERRITORIES_SHARE,
    PERMISSIONS.SETTINGS_VIEW,
    PERMISSIONS.ROLES_VIEW,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.AUDIT_VIEW,
    PERMISSIONS.MANAGE_ALL,
  ],
  publisher: [
    PERMISSIONS.PUBLISHERS_VIEW_MINIMAL,
    PERMISSIONS.MEETINGS_VIEW,
    PERMISSIONS.TERRITORIES_VIEW,
  ],
  viewer: [
    PERMISSIONS.PUBLISHERS_VIEW_MINIMAL,
    PERMISSIONS.MEETINGS_VIEW,
  ],
};

// --- Congregation Role → Keycloak Role Mapping ---
// Maps the congregation role to the minimum Keycloak realm role

export const CONGREGATION_ROLE_MAPPING: Record<string, string> = {
  elder: "elder",
  ministerial_servant: "publisher",
  publisher: "publisher",
};

// --- Page → Required Permission ---

export const PAGE_PERMISSIONS: Record<string, string[]> = {
  "/publishers": [PERMISSIONS.PUBLISHERS_VIEW, PERMISSIONS.PUBLISHERS_VIEW_MINIMAL],
  "/meetings": [PERMISSIONS.MEETINGS_VIEW],
  "/territories": [PERMISSIONS.TERRITORIES_VIEW],
  "/settings": [PERMISSIONS.SETTINGS_VIEW],
  "/audit": [PERMISSIONS.AUDIT_VIEW],
};

// --- Congregation Flags ---

export const CONGREGATION_FLAGS = {
  // Pioneer flags
  REGULAR_PIONEER: "regular_pioneer",
  AUXILIARY_PIONEER: "auxiliary_pioneer",

  // Status flags
  UNBAPTIZED_PUBLISHER: "unbaptized_publisher",
  STUDENT: "student",

  // Elder sub-roles (valid when congregationRole=elder)
  COORDINATOR: "coordinator",
  SECRETARY: "secretary",
  SERVICE_OVERSEER: "service_overseer",
  LIFE_AND_MINISTRY_OVERSEER: "life_and_ministry_overseer",
  WATCHTOWER_CONDUCTOR: "watchtower_conductor",
  CIRCUIT_OVERSEER: "circuit_overseer",

  // MS sub-roles (valid when congregationRole=ministerial_servant)
  ACCOUNTS_SERVANT: "accounts_servant",
  LITERATURE_SERVANT: "literature_servant",
  TERRITORY_SERVANT: "territory_servant",
} as const;

// --- Flag → Auto-Assign AppRole Mapping ---

export const FLAG_TO_ROLE: Record<string, string> = {
  [CONGREGATION_FLAGS.COORDINATOR]: "Coordinator",
  [CONGREGATION_FLAGS.SECRETARY]: "Secretary",
  [CONGREGATION_FLAGS.SERVICE_OVERSEER]: "Service Overseer",
  [CONGREGATION_FLAGS.LIFE_AND_MINISTRY_OVERSEER]: "LM Overseer",
  [CONGREGATION_FLAGS.WATCHTOWER_CONDUCTOR]: "WT Conductor",
  [CONGREGATION_FLAGS.CIRCUIT_OVERSEER]: "Circuit Overseer",
};
