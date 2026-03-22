/**
 * Permission constants and congregation flag definitions.
 *
 * Permission key patterns:
 *   app:<module>.<action>   — feature access
 *   deny:<module>.<field>   — field-level deny
 *   privilege:<name>        — meeting participant privileges
 *   manage:<area>           — management scope
 */

// ─── Congregation Flags ──────────────────────────────────────────────

/** Valid congregation flags by base role */
export const CONGREGATION_FLAGS = {
  /** Available for any role */
  common: [
    "regular_pioneer",
    "auxiliary_pioneer",
    "unbaptized_publisher",
    "student",
    "anointed",
    "special_needs",
  ],
  /** Only valid when congregationRole = elder */
  elder: [
    "coordinator",
    "secretary",
    "service_overseer",
    "life_and_ministry_overseer",
    "watchtower_conductor",
    "circuit_overseer",
  ],
  /** Only valid when congregationRole = ministerial_servant */
  ministerial_servant: [
    "accounts_servant",
    "literature_servant",
    "territory_servant",
  ],
} as const;

export type CongregationFlag =
  | (typeof CONGREGATION_FLAGS.common)[number]
  | (typeof CONGREGATION_FLAGS.elder)[number]
  | (typeof CONGREGATION_FLAGS.ministerial_servant)[number];

// ─── Permission Keys ─────────────────────────────────────────────────

export const PERMISSIONS = {
  // Publishers
  PUBLISHERS_VIEW: "app:publishers.view",
  PUBLISHERS_VIEW_MINIMAL: "app:publishers.view_minimal",
  PUBLISHERS_VIEW_CONTACTS: "app:publishers.view_contacts",
  PUBLISHERS_EDIT: "app:publishers.edit",
  PUBLISHERS_EDIT_LIMITED: "app:publishers.edit_limited",

  // Meetings
  MEETINGS_VIEW: "app:meetings.view",
  MEETINGS_EDIT: "app:meetings.edit",
  MEETINGS_PUBLISH: "app:meetings.publish",

  // Territories
  TERRITORIES_VIEW: "app:territories.view",
  TERRITORIES_EDIT: "app:territories.edit",
  TERRITORIES_ASSIGN: "app:territories.assign",

  // Settings
  SETTINGS_VIEW: "app:settings.view",
  SETTINGS_EDIT: "app:settings.edit",

  // Admin
  ROLES_VIEW: "app:roles.view",
  ROLES_EDIT: "app:roles.edit",
  AUDIT_VIEW: "app:audit.view",
  REPORTS_VIEW: "app:reports.view",

  // Deny rules (field-level restrictions)
  DENY_ADDRESS: "deny:publishers.address",
  DENY_CONTACT: "deny:publishers.contact",
  DENY_NOTES: "deny:publishers.notes",

  // Meeting participant privileges
  PRIVILEGE_TECHNICAL_SOUND: "privilege:technicalSound",
  PRIVILEGE_TECHNICAL_VIDEO: "privilege:technicalVideo",
  PRIVILEGE_TECHNICAL_MICROPHONE: "privilege:technicalMicrophone",
  PRIVILEGE_TECHNICAL_STAGE: "privilege:technicalStage",
  PRIVILEGE_ATTENDANT_MIDWEEK: "privilege:attendantMidweek",
  PRIVILEGE_ATTENDANT_WEEKEND: "privilege:attendantWeekend",
  PRIVILEGE_CHAIRMAN_MIDWEEK: "privilege:chairmanMidweek",
  PRIVILEGE_CHAIRMAN_WEEKEND: "privilege:chairmanWeekend",
  PRIVILEGE_OPENING_PRAYER: "privilege:openingPrayer",
  PRIVILEGE_CLOSING_PRAYER: "privilege:closingPrayer",
  PRIVILEGE_GEMS: "privilege:gems",
  PRIVILEGE_BIBLE_READING: "privilege:bibleReading",
  PRIVILEGE_INITIAL_CALL: "privilege:initialCall",
  PRIVILEGE_RETURN_VISIT: "privilege:returnVisit",
  PRIVILEGE_BIBLE_STUDY: "privilege:bibleStudy",
  PRIVILEGE_TALK: "privilege:talk",
  PRIVILEGE_CBS_CONDUCTOR: "privilege:cbsConductor",
  PRIVILEGE_CBS_READER: "privilege:cbsReader",
  PRIVILEGE_WT_READER: "privilege:wtReader",
  PRIVILEGE_PUBLIC_TALK: "privilege:publicTalk",
  PRIVILEGE_WT_CONDUCTOR: "privilege:wtConductor",
  PRIVILEGE_ZOOM_MODERATOR: "privilege:zoomModerator",
  PRIVILEGE_PUBLIC_TALK_LOCAL: "privilege:publicTalkLocal",
  PRIVILEGE_SERVICE_MEETING_CONDUCTOR: "privilege:serviceMeetingConductor",

  // Student part assistant privileges (householder role)
  PRIVILEGE_INITIAL_CALL_ASSISTANT: "privilege:initialCallAssistant",
  PRIVILEGE_RETURN_VISIT_ASSISTANT: "privilege:returnVisitAssistant",
  PRIVILEGE_BIBLE_STUDY_ASSISTANT: "privilege:bibleStudyAssistant",

  // Cleaning & garden privileges
  PRIVILEGE_CLEANING_DEEP: "privilege:cleaningDeep",
  PRIVILEGE_CLEANING_VISUAL: "privilege:cleaningVisual",
  PRIVILEGE_GARDEN_LAWN: "privilege:gardenLawn",
  PRIVILEGE_GARDEN_WINTER: "privilege:gardenWinter",

  // Sharing
  SHARING_VIEW: "app:sharing.view",
  SHARING_EDIT: "app:sharing.edit",

  // Cleaning module
  CLEANING_VIEW: "app:cleaning.view",

  // Chat
  CHAT_VIEW: "app:chat.view",
  CHAT_SEND: "app:chat.send",
  CHAT_CREATE_SPACE: "app:chat.createSpace",
  CHAT_CROSS_TENANT: "chat:crossTenant",

  // Management scopes
  MANAGE_ALL: "manage:all",
  MANAGE_TECHNIK: "manage:technik",
  MANAGE_ORDNUNGSDIENST: "manage:ordnungsdienst",
  MANAGE_PROGRAM: "manage:program",
  MANAGE_CLEANING: "manage:cleaning",

  // Wildcard
  WILDCARD: "*",
} as const;

// ─── Base Permissions by Keycloak Realm Role ─────────────────────────

/** Base permissions granted by Keycloak realm roles (floor permissions) */
export const BASE_ROLE_PERMISSIONS: Record<string, string[]> = {
  viewer: [
    PERMISSIONS.PUBLISHERS_VIEW_MINIMAL,
    PERMISSIONS.MEETINGS_VIEW,
  ],
  publisher: [
    PERMISSIONS.PUBLISHERS_VIEW_MINIMAL,
    PERMISSIONS.PUBLISHERS_VIEW,
    PERMISSIONS.MEETINGS_VIEW,
    PERMISSIONS.TERRITORIES_VIEW,
    PERMISSIONS.CLEANING_VIEW,
    PERMISSIONS.CHAT_VIEW,
    PERMISSIONS.CHAT_SEND,
  ],
  elder: [
    PERMISSIONS.PUBLISHERS_VIEW,
    PERMISSIONS.PUBLISHERS_VIEW_CONTACTS,
    PERMISSIONS.PUBLISHERS_EDIT,
    PERMISSIONS.MEETINGS_VIEW,
    PERMISSIONS.MEETINGS_EDIT,
    PERMISSIONS.TERRITORIES_VIEW,
    PERMISSIONS.TERRITORIES_EDIT,
    PERMISSIONS.TERRITORIES_ASSIGN,
    PERMISSIONS.SETTINGS_VIEW,
    PERMISSIONS.ROLES_VIEW,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.CHAT_VIEW,
    PERMISSIONS.CHAT_SEND,
    PERMISSIONS.CHAT_CREATE_SPACE,
    PERMISSIONS.CHAT_CROSS_TENANT,
  ],
  admin: [PERMISSIONS.WILDCARD],
};

// ─── CongregationRole → Base Permissions ─────────────────────────────

/** Base permissions from CongregationRole (with inheritance) */
export const CONGREGATION_ROLE_PERMISSIONS: Record<string, string[]> = {
  publisher: [
    PERMISSIONS.PUBLISHERS_VIEW_MINIMAL,
    PERMISSIONS.MEETINGS_VIEW,
  ],
  ministerial_servant: [
    // Inherits publisher
    PERMISSIONS.PUBLISHERS_VIEW_MINIMAL,
    PERMISSIONS.MEETINGS_VIEW,
    // Own additions
    PERMISSIONS.PUBLISHERS_VIEW,
    PERMISSIONS.TERRITORIES_VIEW,
  ],
  elder: [
    // Inherits publisher (NOT ministerial_servant)
    PERMISSIONS.PUBLISHERS_VIEW_MINIMAL,
    PERMISSIONS.MEETINGS_VIEW,
    // Own additions
    PERMISSIONS.PUBLISHERS_VIEW,
    PERMISSIONS.PUBLISHERS_VIEW_CONTACTS,
    PERMISSIONS.PUBLISHERS_EDIT,
    PERMISSIONS.MEETINGS_EDIT,
    PERMISSIONS.TERRITORIES_VIEW,
    PERMISSIONS.TERRITORIES_EDIT,
    PERMISSIONS.TERRITORIES_ASSIGN,
    PERMISSIONS.SETTINGS_VIEW,
    PERMISSIONS.ROLES_VIEW,
    PERMISSIONS.REPORTS_VIEW,
  ],
};

// ─── Page Visibility Mapping ─────────────────────────────────────────

/** Maps route paths to required permissions */
export const PAGE_PERMISSIONS: Record<string, string[]> = {
  "/publishers": [PERMISSIONS.PUBLISHERS_VIEW, PERMISSIONS.PUBLISHERS_VIEW_MINIMAL],
  "/meetings": [PERMISSIONS.MEETINGS_VIEW],
  "/territories": [PERMISSIONS.TERRITORIES_VIEW],
  "/cleaning": [PERMISSIONS.CLEANING_VIEW],
  "/settings": [PERMISSIONS.SETTINGS_VIEW],
  "/audit": [PERMISSIONS.AUDIT_VIEW],
};

// ─── Flag → Auto-Assign AppRole Mapping ──────────────────────────────

/** Maps congregation flags to auto-assigned AppRole names */
export const FLAG_TO_APP_ROLE: Record<string, string> = {
  coordinator: "Coordinator",
  secretary: "Secretary",
  service_overseer: "Service Overseer",
  life_and_ministry_overseer: "LM Overseer",
  watchtower_conductor: "WT Conductor",
  circuit_overseer: "Circuit Overseer",
};
