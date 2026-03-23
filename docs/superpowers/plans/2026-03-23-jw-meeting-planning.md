# JW Meeting Planning (Midweek + Weekend) — Feature Design & Implementation Plan

> **For agentic workers:** REQUIRED: implement in `hubport.cloud` only. The old `hub` repo is a frozen reference source for concepts, not a target for new code. All JW.org ingestion must run server-side in `hub-api`, inside the tenant container. Do not scrape or parse JW.org content in the browser.

**Goal:** Add congregation meeting planning to `hubport.cloud` for midweek and weekend meetings, including JW.org workbook import, assignment workflows, duty planning, weekend study linkage, and public talk planning. Midweek planning is owned by the Life and Ministry Overseer. Public talk planning remains independent from midweek workbook periods.

**Current codebase anchors:**
- `hub-api/src/lib/permissions.ts`
- `hub-api/src/lib/seed-roles.ts`
- `hub-api/src/lib/rbac.ts`
- `hub-api/src/lib/policy-engine.ts`
- `hub-api/prisma/schema.prisma`
- `hub-api/src/routes/meetings.ts`
- frozen reference only:
  - `../hub/services/hub-api/prisma/schema.prisma`
  - `../hub/services/hub-api/src/routes/workbook.ts`

---

## 1. Executive Summary

`hubport.cloud` already has a useful RBAC base for congregation responsibilities, but it does not yet have a real meeting-planning domain. The current `Meeting` model is still basic CRUD, and meeting routes still use legacy role checks. The design should therefore:

1. Keep the current RBAC foundation and extend it.
2. Introduce a proper planning data model in `hub-api`.
3. Run all JW.org import logic server-side in the tenant container.
4. Make midweek planning workbook-driven and period-based.
5. Keep weekend public talk planning separate from midweek periods.
6. Use permission-based guards for all new planning routes.

---

## 2. Confirmed Current-State RBAC Crosscheck

This plan is based on the current `hubport.cloud` RBAC, not assumptions.

### Already present and reusable

- `LM Overseer` seeded app role exists with:
  - `app:meetings.view`
  - `app:meetings.edit`
  - `app:meetings.publish`
  - `app:publishers.view_minimal`
  - `manage:program`
- `WT Conductor` seeded role exists for weekend scope.
- `Technik`, `Ordnungsdienst`, `Technik Responsible`, `Cleaning Responsible`, and many individual privilege roles already exist.
- Permission constants already include:
  - meeting module permissions
  - privilege-level meeting capabilities
  - management scopes such as `manage:program`, `manage:technik`, and `manage:ordnungsdienst`
- Permission-based route guards already exist in `rbac.ts`.
- `policy-engine.ts` already supports app-role scope (`all`, `midweek`, `weekend`) and can be extended cleanly.

### Current gaps

- `Meeting` is only:
  - `title`
  - `type`
  - `date`
  - `startTime`
  - `endTime`
  - `location`
  - `notes`
- `meetings.ts` still uses legacy `requireRole()` checks instead of permission-based planning guards.
- There is no current support for:
  - workbook editions
  - workbook weeks or parts
  - planning periods
  - assignment slots
  - weekend study metadata
  - public talk scheduling
  - speaker directory
  - assignment history

Conclusion: RBAC is real and reusable, but the meeting-planning domain still needs to be built.

---

## 3. Product Scope

### In scope

- Midweek workbook import from JW.org by congregation language
- Automatic opening of a midweek planning period from imported workbook content
- Assignment of midweek program parts and operational duties
- Weekend meeting duty planning
- Weekend Watchtower study metadata import and linkage
- Public talk planning as a separate weekend stream
- RBAC enforcement for planning and assignment workflows
- Auditability, publish workflow, and lock workflow

### Out of scope for the first implementation

- Browser-side JW.org ingestion
- Direct code reuse from the frozen `hub` repo
- Fully automated public talk content import from external sources
- Replacing the existing auth or policy-engine foundation

---

## 4. Planning Domain Model

Split the feature into three related planning domains.

### 4.1 Midweek planning

- Source of truth: imported JW.org workbook edition
- Owner: `LM Overseer`
- Output:
  - bounded planning period
  - seeded midweek meetings
  - seeded program slots
  - seeded duty slots
- Lifecycle:
  - import
  - open
  - assign
  - publish
  - lock

### 4.2 Weekend planning

- Source of truth: concrete weekend meetings plus imported study-week metadata
- Owners:
  - `WT Conductor` for study-side planning
  - duty managers for duty assignment
- Output:
  - study-linked weekend meetings
  - duty assignments
  - publish/lock workflow at meeting level

### 4.3 Public talk planning

- Separate from midweek planning periods
- Related to weekend meetings, but not governed by workbook lifecycle
- Owner: new dedicated public talk coordinator role
- Output:
  - speaker/talk schedule
  - invitation workflow
  - confirmation/cancellation tracking

---

## 5. Core Product Rules

1. All JW.org ingestion runs server-side in `hub-api`.
2. The tenant container performs all fetch/parse/import work.
3. The frontend only triggers imports, shows previews, and manages assignments.
4. Importing a midweek workbook creates or opens a planning period for the relevant weeks.
5. Midweek assignments are period-bound.
6. Weekend talk planning is independent from the midweek period.
7. Weekend duties are attached to actual weekend meetings.
8. Privilege to perform a part is different from permission to assign a part.
9. Reimport must not silently overwrite published work.
10. Late substitutions must remain possible with audit history.

---

## 6. Proposed Data Model

Extend `hub-api/prisma/schema.prisma`.

### 6.1 Extend `Meeting`

Keep `Meeting` as the real scheduled event and add planning linkage instead of replacing it.

Add fields:
- `meetingPeriodId`
- `workbookWeekId`
- `weekendStudyWeekId`
- `status`: `draft`, `published`, `locked`
- optional `publishedAt`, `publishedBy`

### 6.2 New models

#### `CongregationSettings`
- congregation language
- JW.org language code
- default meeting times
- public talk planning defaults
- import preferences

#### `MeetingPeriod`
- `id`
- `type`: `midweek_workbook`, `weekend_study`
- `status`: `draft`, `open`, `published`, `locked`, `archived`
- `language`
- `startDate`
- `endDate`
- `sourceEditionId`
- `openedBy`, `openedAt`
- `publishedBy`, `publishedAt`
- `lockedBy`, `lockedAt`

#### `WorkbookEdition`
- `id`
- `language`
- `yearMonth` or issue key
- `sourceUrl`
- `sourcePublicationCode`
- `checksum`
- `importedAt`
- raw import metadata

#### `WorkbookWeek`
- `id`
- `editionId`
- `weekOf`
- theme/reference metadata
- song metadata
- sort order

#### `WorkbookPart`
- `id`
- `weekId`
- `section`
- `partType`
- `title`
- `durationMinutes`
- source metadata
- normalized assignment requirements

#### `WeekendStudyEdition`
- `id`
- `language`
- issue metadata
- `checksum`
- `importedAt`

#### `WeekendStudyWeek`
- `id`
- `editionId`
- `weekOf`
- article title
- article URL
- study number
- source metadata

#### `MeetingSlotTemplate`
- canonical slot definitions
- `meetingType`: `midweek`, `weekend`, `all`
- `slotKey`
- `label`
- required privilege key(s)
- whether assistant is allowed or required
- whether assignment is operational duty or program part

#### `MeetingAssignment`
- `id`
- `meetingId`
- `slotTemplateId`
- optional `workbookPartId`
- optional `assigneePublisherId`
- optional `assistantPublisherId`
- `status`
- `source`: `auto_seeded`, `manual`, `imported`
- `notes`
- audit metadata

#### `Speaker`
- local/external speaker identity
- congregation/source metadata
- contact metadata
- status

#### `PublicTalk`
- talk number
- title
- optional normalized talk metadata

#### `PublicTalkSchedule`
- `id`
- `meetingId`
- `speakerId`
- `publicTalkId`
- `mode`: `local`, `incoming_guest`, `outgoing_guest`
- invitation state
- confirmation fields
- notes

#### `AssignmentHistory`
- immutable event log of assignment actions
- create, update, unassign, substitute, publish, lock, reopen

---

## 7. Import Architecture

All import logic must live in `hub-api`.

### 7.1 New importer module

Create:
- `hub-api/src/lib/importers/jw/`

Suggested files:
- `jw-client.ts`
- `midweek-workbook-importer.ts`
- `weekend-study-importer.ts`
- `import-cache.ts`
- `import-validator.ts`
- `types.ts`

### 7.2 Importer responsibilities

#### `jw-client.ts`
- fetch official JW.org content for the configured language
- centralize request headers, retries, timeout, and caching
- keep network behavior deterministic and auditable

#### `midweek-workbook-importer.ts`
- fetch selected workbook edition
- parse weeks and parts
- normalize output into internal part taxonomy
- emit preview data before persistence

#### `weekend-study-importer.ts`
- fetch selected Watchtower Study issue
- map articles to study weeks
- emit normalized week/article data

#### `import-cache.ts`
- store source URL
- checksum
- fetched timestamp
- parser version
- raw payload snapshot

#### `import-validator.ts`
- ensure minimum parse completeness
- reject partial imports that would leave planning unusable

### 7.3 Parser rules

- Prefer HTML/text sources over PDF-first parsing.
- Normalize imported content to internal types, not display strings.
- Make import idempotent by edition identity and checksum.
- Support preview before commit.
- Store enough source metadata to debug parser drift later.

---

## 8. Midweek Planning Lifecycle

Owner: `LM Overseer`

### Workflow

1. LM Overseer selects congregation language and workbook edition.
2. Frontend calls `hub-api` preview import endpoint.
3. `hub-api` fetches and parses JW.org source server-side.
4. Preview shows weeks, parts, warnings, and whether this replaces an earlier import.
5. LM Overseer confirms import.
6. System creates:
   - `WorkbookEdition`
   - `WorkbookWeek`
   - `WorkbookPart`
   - `MeetingPeriod` with status `open`
   - missing `Meeting` rows for the covered weeks
   - seeded `MeetingAssignment` rows for parts and duties
7. LM Overseer assigns:
   - program participants
   - assistant roles where applicable
   - chairman/prayers
   - required duties
8. LM Overseer publishes one meeting or a set of meetings.
9. Past or finalized weeks can be locked.
10. Last-minute substitutions are recorded through assignment history.

### Important rule

The planning period opens because the workbook import succeeded. The user should not need a separate manual “create period” workflow for normal midweek planning.

---

## 9. Weekend Planning Lifecycle

### Study-side planning

Owner: `WT Conductor`

1. Select congregation language and study issue or week range.
2. Trigger server-side import preview in `hub-api`.
3. Confirm import.
4. System links or seeds `WeekendStudyWeek` rows.
5. Weekend meetings attach to the relevant study week.
6. Weekend assignments can be prepared and published.

### Duty planning

Weekend duties belong to the actual weekend meeting instance, not to a midweek planning period.

Examples:
- weekend chairman
- opening/closing prayer
- WT reader
- attendants
- sound
- video
- microphones

---

## 10. Public Talk Planning Lifecycle

Owner: new `Public Talk Coordinator` app role

### Rules

- Public talk planning is not tied to the midweek workbook period.
- It is related to weekend meetings but should remain separately manageable.
- It may be planned further into the future than weekend duty assignments.

### Workflow

1. Maintain speakers and talk catalog.
2. Create public talk schedule entries linked to weekend meetings.
3. Manage invitation state:
   - draft
   - invited
   - confirmed
   - declined
   - cancelled
4. Allow local and guest speaker modes.
5. Publish alongside the weekend meeting when ready.

---

## 11. RBAC Design

### 11.1 Keep and reuse current permissions

Continue using:
- `app:meetings.view`
- `app:meetings.edit`
- `app:meetings.publish`
- `manage:program`
- `manage:technik`
- `manage:ordnungsdienst`
- `privilege:*` assignment eligibility permissions

### 11.2 Add new feature permissions

Add:
- `app:workbooks.view`
- `app:workbooks.import`
- `app:meeting_periods.view`
- `app:meeting_periods.manage`
- `app:meeting_assignments.view`
- `app:meeting_assignments.edit`
- `app:weekend_study.view`
- `app:weekend_study.import`
- `app:public_talks.view`
- `app:public_talks.edit`
- `app:speakers.view`
- `app:speakers.edit`

### 11.3 Add narrower management scopes

Add:
- `manage:midweek_program`
- `manage:weekend_program`
- `manage:meeting_duties`
- `manage:public_talks`

### 11.4 Role updates

#### `LM Overseer`
Extend to include:
- workbook import permissions
- meeting period management
- meeting assignment edit for midweek scope

#### `WT Conductor`
Extend to include:
- weekend study import/view
- weekend program assignment management for study-related items

#### New `Public Talk Coordinator`
Grant:
- public talk schedule management
- speaker directory management
- public talk publishing rights for weekend scope

#### Existing `Technik Responsible`
Keep as duty manager for technical slots.

#### Existing `Ordnungsdienst` / future `Ordnungsdienst Responsible`
Use for attendant assignment scope.

### 11.5 Separation of concerns

Do not conflate:
- “may perform part” with
- “may assign part”

Privilege permissions remain eligibility signals.
Management permissions remain planner authority signals.

---

## 12. Eligibility Engine

Implement a central assignment eligibility resolver.

### Inputs

- congregation role
- congregation flags
- app roles
- effective permissions
- privilege keys
- gender
- availability/conflict data
- local congregation rules if configured

### Outputs

- `eligible`
- `reasonCodes`
- `warnings`
- `assistantEligible`

### Rules

- A person can assign a part without being eligible to perform it.
- Assistant parts use separate assistant eligibility permissions.
- Duties like sound, video, microphone, attendant are driven by slot template + privilege.
- Public talk scheduling must distinguish local speaker vs incoming guest vs outgoing guest.

---

## 13. API Design

New planning routes must use permission-based guards from `rbac.ts`, not legacy `requireRole()`.

### `/workbooks`

- `GET /workbooks/editions`
- `POST /workbooks/import/preview`
- `POST /workbooks/import/commit`
- `GET /workbooks/:id`
- `POST /workbooks/:id/open-period`

### `/meeting-periods`

- `GET /meeting-periods`
- `GET /meeting-periods/:id`
- `POST /meeting-periods/:id/publish`
- `POST /meeting-periods/:id/lock`
- `POST /meeting-periods/:id/reopen`

### `/meeting-assignments`

- `GET /meeting-assignments`
- `POST /meeting-assignments`
- `PUT /meeting-assignments/:id`
- `DELETE /meeting-assignments/:id`
- `POST /meeting-assignments/validate`
- `POST /meeting-assignments/:id/substitute`

### `/weekend-study`

- `POST /weekend-study/import/preview`
- `POST /weekend-study/import/commit`
- `GET /weekend-study/weeks`

### `/public-talks`

- `GET /public-talks/schedule`
- `POST /public-talks/schedule`
- `PUT /public-talks/schedule/:id`
- `POST /public-talks/schedule/:id/invite`
- `POST /public-talks/schedule/:id/confirm`
- `POST /public-talks/schedule/:id/cancel`

### `/speakers`

- `GET /speakers`
- `POST /speakers`
- `PUT /speakers/:id`
- `GET /speakers/:id`

### Existing `/meetings`

Keep CRUD but extend with planning-aware behavior later:
- `GET /meetings/:id/assignments`
- `POST /meetings/:id/seed-slots`

---

## 14. UI Design

Add planning-focused pages in `hub-app`.

### Midweek Planner

- select workbook/language
- preview import
- show open period
- assign parts and duties by week
- publish and lock controls

### Workbook Library

- imported editions
- parse warnings
- replacement/reimport history

### Weekend Planner

- select weekend meeting
- show linked WT study article
- assign weekend duties
- separate public talk card

### Public Talk Planner

- plan across a longer date horizon
- manage speaker/talk pairings
- manage invitation state

### Speaker Directory

- maintain local and guest speaker records

---

## 15. Migration Strategy From Frozen `hub`

Use the old repo only as a concept reference.

### Reuse conceptually

- workbook import preview pattern
- edition/week/part normalization
- duty-definition versus assignment separation
- assignment planning ergonomics

### Do not port directly

- old auth and tenant middleware model
- old schema naming wholesale
- old route structure

### Source-of-truth rule

When old `hub` and current `hubport.cloud` differ, current `hubport.cloud` architecture wins.

---

## 16. Implementation Phases

### Phase 1: Planning foundation

- add schema for periods, editions, weeks, parts, slots, assignments
- extend meeting model
- add new permissions and seeded roles
- wire policy-engine support for new permissions

### Phase 2: Midweek import and period opening

- build server-side workbook importer in `hub-api`
- add preview and commit endpoints
- create period + seed meetings + seed slots on import

### Phase 3: Midweek assignment workflow

- implement eligibility engine
- implement assignment APIs
- build Midweek Planner UI
- add publish/lock workflow

### Phase 4: Weekend study planning

- build weekend study importer
- link study weeks to weekend meetings
- build Weekend Planner duty flow

### Phase 5: Public talk planning

- add speakers, talks, schedule, invitation states
- add Public Talk Planner UI
- integrate with weekend meetings without coupling to midweek periods

### Phase 6: Hardening and automation

- import fixtures by language
- parser regression coverage
- optional background “new edition available” checks
- non-destructive reimport behavior

---

## 17. Acceptance Criteria

- LM Overseer can trigger workbook import for the congregation language from the UI.
- Import runs entirely in `hub-api`.
- Successful import automatically opens a midweek planning period.
- Midweek weeks and parts are persisted and visible in planner UI.
- Midweek parts and duties can be assigned with eligibility checks.
- Weekend duties can be planned independently of midweek periods.
- Public talk planning is independent from midweek periods.
- RBAC correctly separates:
  - who may plan
  - who may perform
  - who may publish
- Reimport does not silently destroy published work.
- Assignment changes and publication actions are auditable.

---

## 18. Explicit Implementation Constraints For Claude

1. Implement in `hubport.cloud`, not the frozen `hub` repo.
2. Do not scrape in the browser.
3. All JW.org ingestion runs server-side in `hub-api`.
4. Treat the tenant container as the importer runtime.
5. Use permission-based guards for all new planning routes.
6. Extend current RBAC; do not replace it.
7. `LM Overseer` owns midweek planning lifecycle.
8. Public talk planning must remain independent from midweek workbook periods.
9. Weekend duties belong to concrete weekend meetings.
10. Preserve auditability and non-destructive reimport behavior.

