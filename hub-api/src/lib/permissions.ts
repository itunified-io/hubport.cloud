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
  PUBLISHERS_RESET_PASSWORD: "app:publishers.reset_password",

  // Meetings
  MEETINGS_VIEW: "app:meetings.view",
  MEETINGS_EDIT: "app:meetings.edit",
  MEETINGS_PUBLISH: "app:meetings.publish",

  // Workbook import
  WORKBOOKS_VIEW: "app:workbooks.view",
  WORKBOOKS_IMPORT: "app:workbooks.import",

  // Meeting periods
  MEETING_PERIODS_VIEW: "app:meeting_periods.view",
  MEETING_PERIODS_MANAGE: "app:meeting_periods.manage",

  // Meeting assignments
  MEETING_ASSIGNMENTS_VIEW: "app:meeting_assignments.view",
  MEETING_ASSIGNMENTS_EDIT: "app:meeting_assignments.edit",

  // Weekend study
  WEEKEND_STUDY_VIEW: "app:weekend_study.view",
  WEEKEND_STUDY_IMPORT: "app:weekend_study.import",

  // Public talks
  PUBLIC_TALKS_VIEW: "app:public_talks.view",
  PUBLIC_TALKS_EDIT: "app:public_talks.edit",

  // Speakers
  SPEAKERS_VIEW: "app:speakers.view",
  SPEAKERS_EDIT: "app:speakers.edit",

  // Away periods (availability)
  AWAY_PERIODS_VIEW: "app:away_periods.view",
  AWAY_PERIODS_EDIT: "app:away_periods.edit",

  // Territories
  TERRITORIES_VIEW: "app:territories.view",
  TERRITORIES_EDIT: "app:territories.edit",
  TERRITORIES_ASSIGN: "app:territories.assign",
  TERRITORIES_DELETE: "app:territories.delete",
  TERRITORIES_SPLIT: "app:territories.split",
  TERRITORIES_IMPORT: "app:territories.import",
  TERRITORIES_SHARE: "app:territories.share",

  // Addresses & OSM
  ADDRESSES_VIEW: "app:addresses.view",
  ADDRESSES_EDIT: "app:addresses.edit",
  ADDRESSES_VISIT: "app:addresses.visit",
  ADDRESSES_IMPORT: "app:addresses.import",
  OSM_REFRESH: "app:osm.refresh",
  OSM_EDIT: "app:osm.edit",
  GAP_DETECTION_VIEW: "app:gap_detection.view",
  GAP_DETECTION_RUN: "app:gap_detection.run",

  // Territory Operations
  ASSIGNMENTS_VIEW: "app:assignments.view",
  ASSIGNMENTS_MANAGE: "app:assignments.manage",
  CAMPAIGNS_VIEW: "app:campaigns.view",
  CAMPAIGNS_MANAGE: "app:campaigns.manage",
  CAMPAIGNS_CONDUCT: "app:campaigns.conduct",
  CAMPAIGNS_ASSIST: "app:campaigns.assist",
  CAMPAIGNS_REPORT: "app:campaigns.report",
  CAMPAIGNS_LOCATION_SHARE: "app:campaigns.location_share",
  LOCATION_VIEW: "app:location.view",

  // Field Service
  FIELD_SERVICE_VIEW: "app:field_service.view",
  MEETING_POINTS_VIEW: "app:meeting_points.view",
  MEETING_POINTS_MANAGE: "app:meeting_points.manage",
  SERVICE_MEETINGS_VIEW: "app:service_meetings.view",
  SERVICE_MEETINGS_MANAGE: "app:service_meetings.manage",
  SERVICE_MEETINGS_SIGNUP: "app:service_meetings.signup",
  SERVICE_MEETINGS_CONDUCT: "app:service_meetings.conduct",

  // Field Work
  FIELD_WORK_GPS: "app:field_work.gps",
  FIELD_WORK_OVERSEER: "app:field_work.overseer",

  // Groups
  GROUPS_VIEW: "app:groups.view",
  GROUPS_EDIT: "app:groups.edit",

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
  PRIVILEGE_PUBLIC_TALK_VISITING: "privilege:publicTalkVisiting",
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
  SHARING_CONFIGURE: "app:sharing.configure",

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
  MANAGE_MIDWEEK_PROGRAM: "manage:midweek_program",
  MANAGE_WEEKEND_PROGRAM: "manage:weekend_program",
  MANAGE_MEETING_DUTIES: "manage:meeting_duties",
  MANAGE_PUBLIC_TALKS: "manage:public_talks",

  // Devices
  DEVICES_VIEW: "app:devices.view",
  DEVICES_MANAGE: "app:devices.manage",
  ADMIN_DEVICES_VIEW: "app:admin.devices.view",
  ADMIN_DEVICES_MANAGE: "app:admin.devices.manage",

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
    PERMISSIONS.SHARING_VIEW,
    PERMISSIONS.ADDRESSES_VIEW,
    PERMISSIONS.ADDRESSES_VISIT,
    PERMISSIONS.ASSIGNMENTS_VIEW,
    PERMISSIONS.CAMPAIGNS_VIEW,
    PERMISSIONS.CAMPAIGNS_LOCATION_SHARE,
    PERMISSIONS.FIELD_SERVICE_VIEW,
    PERMISSIONS.MEETING_POINTS_VIEW,
    PERMISSIONS.SERVICE_MEETINGS_VIEW,
    PERMISSIONS.SERVICE_MEETINGS_SIGNUP,
    PERMISSIONS.FIELD_WORK_GPS,
    PERMISSIONS.DEVICES_VIEW,
    PERMISSIONS.DEVICES_MANAGE,
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
    PERMISSIONS.TERRITORIES_DELETE,
    PERMISSIONS.TERRITORIES_SPLIT,
    PERMISSIONS.TERRITORIES_IMPORT,
    PERMISSIONS.TERRITORIES_SHARE,
    PERMISSIONS.ADDRESSES_VIEW,
    PERMISSIONS.ADDRESSES_EDIT,
    PERMISSIONS.ADDRESSES_VISIT,
    PERMISSIONS.ADDRESSES_IMPORT,
    PERMISSIONS.OSM_REFRESH,
    PERMISSIONS.OSM_EDIT,
    PERMISSIONS.GAP_DETECTION_VIEW,
    PERMISSIONS.GAP_DETECTION_RUN,
    PERMISSIONS.ASSIGNMENTS_VIEW,
    PERMISSIONS.ASSIGNMENTS_MANAGE,
    PERMISSIONS.CAMPAIGNS_VIEW,
    PERMISSIONS.CAMPAIGNS_MANAGE,
    PERMISSIONS.CAMPAIGNS_CONDUCT,
    PERMISSIONS.CAMPAIGNS_ASSIST,
    PERMISSIONS.CAMPAIGNS_REPORT,
    PERMISSIONS.CAMPAIGNS_LOCATION_SHARE,
    PERMISSIONS.LOCATION_VIEW,
    PERMISSIONS.FIELD_SERVICE_VIEW,
    PERMISSIONS.MEETING_POINTS_VIEW,
    PERMISSIONS.MEETING_POINTS_MANAGE,
    PERMISSIONS.SERVICE_MEETINGS_VIEW,
    PERMISSIONS.SERVICE_MEETINGS_MANAGE,
    PERMISSIONS.SERVICE_MEETINGS_SIGNUP,
    PERMISSIONS.SERVICE_MEETINGS_CONDUCT,
    PERMISSIONS.GROUPS_VIEW,
    PERMISSIONS.GROUPS_EDIT,
    PERMISSIONS.SETTINGS_VIEW,
    PERMISSIONS.ROLES_VIEW,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.PUBLISHERS_RESET_PASSWORD,
    PERMISSIONS.CHAT_VIEW,
    PERMISSIONS.CHAT_SEND,
    PERMISSIONS.CHAT_CREATE_SPACE,
    PERMISSIONS.CHAT_CROSS_TENANT,
    PERMISSIONS.SHARING_VIEW,
    PERMISSIONS.SHARING_EDIT,
    PERMISSIONS.FIELD_WORK_GPS,
    PERMISSIONS.DEVICES_VIEW,
    PERMISSIONS.DEVICES_MANAGE,
  ],
  admin: [PERMISSIONS.WILDCARD],
};

// ─── CongregationRole → Base Permissions ─────────────────────────────

/** Base permissions from CongregationRole (with inheritance) */
export const CONGREGATION_ROLE_PERMISSIONS: Record<string, string[]> = {
  publisher: [
    PERMISSIONS.PUBLISHERS_VIEW_MINIMAL,
    PERMISSIONS.MEETINGS_VIEW,
    PERMISSIONS.ADDRESSES_VIEW,
    PERMISSIONS.ASSIGNMENTS_VIEW,
    PERMISSIONS.CAMPAIGNS_VIEW,
    PERMISSIONS.CAMPAIGNS_LOCATION_SHARE,
    PERMISSIONS.FIELD_SERVICE_VIEW,
    PERMISSIONS.MEETING_POINTS_VIEW,
    PERMISSIONS.SERVICE_MEETINGS_VIEW,
    PERMISSIONS.SERVICE_MEETINGS_SIGNUP,
  ],
  ministerial_servant: [
    // Inherits publisher
    PERMISSIONS.PUBLISHERS_VIEW_MINIMAL,
    PERMISSIONS.MEETINGS_VIEW,
    // Own additions
    PERMISSIONS.PUBLISHERS_VIEW,
    PERMISSIONS.TERRITORIES_VIEW,
    PERMISSIONS.FIELD_SERVICE_VIEW,
    PERMISSIONS.MEETING_POINTS_VIEW,
    PERMISSIONS.SERVICE_MEETINGS_VIEW,
    PERMISSIONS.SERVICE_MEETINGS_MANAGE,
    PERMISSIONS.SERVICE_MEETINGS_SIGNUP,
    PERMISSIONS.SERVICE_MEETINGS_CONDUCT,
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
  "/meetings/planner": [PERMISSIONS.MEETING_ASSIGNMENTS_VIEW, PERMISSIONS.MANAGE_MIDWEEK_PROGRAM],
  "/meetings/weekend": [PERMISSIONS.MEETING_ASSIGNMENTS_VIEW, PERMISSIONS.MANAGE_WEEKEND_PROGRAM],
  "/meetings/public-talks": [PERMISSIONS.PUBLIC_TALKS_VIEW, PERMISSIONS.MANAGE_PUBLIC_TALKS],
  "/meetings/speakers": [PERMISSIONS.SPEAKERS_VIEW],
  "/meetings/workbooks": [PERMISSIONS.WORKBOOKS_VIEW],
  "/territories": [PERMISSIONS.TERRITORIES_VIEW, PERMISSIONS.ADDRESSES_VIEW],
  "/territories/gap-detection": [PERMISSIONS.GAP_DETECTION_VIEW],
  "/territories/kanban": [PERMISSIONS.ASSIGNMENTS_VIEW],
  "/territories/field-work": [PERMISSIONS.FIELD_WORK_OVERSEER],
  "/field-service": [PERMISSIONS.FIELD_SERVICE_VIEW],
  "/field-service/campaigns": [PERMISSIONS.CAMPAIGNS_VIEW],
  "/field-service/meeting-points": [PERMISSIONS.MEETING_POINTS_VIEW],
  "/field-service/groups": [PERMISSIONS.SERVICE_MEETINGS_VIEW],
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
  territory_servant: "Territory Servant",
};
