/**
 * Assignment Eligibility Engine.
 *
 * Determines whether a publisher is eligible to fill a specific meeting slot,
 * based on their roles, privileges, gender, and congregation flags.
 *
 * Key rule: "may assign" ≠ "may perform". Privilege permissions are
 * eligibility signals, management permissions are planner authority signals.
 */

import prisma from "./prisma.js";

export interface EligibilityInput {
  publisherId: string;
  slotKey: string;
  meetingType: "midweek" | "weekend";
  isAssistant?: boolean;
}

export interface EligibilityResult {
  eligible: boolean;
  assistantEligible: boolean;
  reasonCodes: string[];
  warnings: string[];
}

/**
 * Check if a publisher is eligible for a specific meeting slot.
 */
export async function checkEligibility(
  input: EligibilityInput,
): Promise<EligibilityResult> {
  const { publisherId, slotKey, meetingType, isAssistant } = input;
  const reasonCodes: string[] = [];
  const warnings: string[] = [];

  // 1. Load publisher with app roles
  const publisher = await prisma.publisher.findUnique({
    where: { id: publisherId },
    include: {
      appRoles: {
        include: { role: true },
        where: {
          OR: [
            { validTo: null },
            { validTo: { gte: new Date() } },
          ],
          AND: [
            { OR: [{ validFrom: null }, { validFrom: { lte: new Date() } }] },
          ],
        },
      },
    },
  });

  if (!publisher) {
    return { eligible: false, assistantEligible: false, reasonCodes: ["publisher_not_found"], warnings };
  }

  if (publisher.status !== "active") {
    return { eligible: false, assistantEligible: false, reasonCodes: ["publisher_inactive"], warnings };
  }

  // 2. Load slot template
  const slotTemplate = await prisma.meetingSlotTemplate.findUnique({
    where: { slotKey },
  });

  if (!slotTemplate) {
    return { eligible: false, assistantEligible: false, reasonCodes: ["slot_not_found"], warnings };
  }

  // 3. Check meeting type scope
  if (slotTemplate.meetingType !== "all" && slotTemplate.meetingType !== meetingType) {
    reasonCodes.push("wrong_meeting_type");
    return { eligible: false, assistantEligible: false, reasonCodes, warnings };
  }

  // 4. Collect effective permissions from app roles
  const effectivePermissions = new Set<string>();
  for (const arm of publisher.appRoles) {
    const perms = arm.role.permissions as string[];
    const scope = arm.role.scope;
    // Check scope match
    if (scope === "all" || scope === meetingType) {
      for (const p of perms) {
        effectivePermissions.add(p);
      }
    }
  }

  // Wildcard grants everything
  if (effectivePermissions.has("*")) {
    return { eligible: true, assistantEligible: true, reasonCodes: ["wildcard"], warnings };
  }

  // 5. Check required privileges for the slot
  const requiredPrivileges = slotTemplate.requiredPrivileges as string[];
  const hasPrivilege = requiredPrivileges.length === 0 ||
    requiredPrivileges.some((p) => effectivePermissions.has(p));

  if (!hasPrivilege) {
    reasonCodes.push("missing_privilege");
  }

  // 6. Check gender constraints for certain parts
  const genderRestricted = checkGenderEligibility(slotKey, publisher.gender);
  if (!genderRestricted.eligible) {
    reasonCodes.push(genderRestricted.reason);
  }

  // 7. Assistant eligibility check
  let assistantEligible = false;
  if (isAssistant || slotTemplate.allowsAssistant) {
    // Check assistant-specific privileges
    const assistantPrivileges = [
      "privilege:initialCallAssistant",
      "privilege:returnVisitAssistant",
      "privilege:bibleStudyAssistant",
    ];
    assistantEligible = assistantPrivileges.some((p) => effectivePermissions.has(p));
    // Sisters can be assistants for student parts
    if (publisher.gender === "female" && isStudentPart(slotKey)) {
      assistantEligible = true;
    }
  }

  const eligible = reasonCodes.length === 0 && hasPrivilege;

  return { eligible, assistantEligible, reasonCodes, warnings };
}

/**
 * Get all eligible publishers for a slot.
 */
export async function getEligiblePublishers(
  slotKey: string,
  meetingType: "midweek" | "weekend",
): Promise<{ publisherId: string; firstName: string; lastName: string; displayName: string | null }[]> {
  const publishers = await prisma.publisher.findMany({
    where: { status: "active" },
    select: { id: true, firstName: true, lastName: true, displayName: true },
  });

  const eligible: typeof publishers = [];

  for (const pub of publishers) {
    const result = await checkEligibility({
      publisherId: pub.id,
      slotKey,
      meetingType,
    });
    if (result.eligible) {
      eligible.push(pub);
    }
  }

  return eligible;
}

/**
 * Gender-based eligibility rules.
 */
function checkGenderEligibility(
  slotKey: string,
  gender: string | null,
): { eligible: boolean; reason: string } {
  // Parts restricted to brothers (elders/MS)
  const maleOnlySlots = [
    "chairman_midweek", "chairman_weekend",
    "opening_prayer_midweek", "opening_prayer_weekend",
    "closing_prayer_midweek", "closing_prayer_weekend",
    "gems", "talk_midweek", "public_talk",
    "cbs_conductor", "cbs_reader",
    "wt_conductor", "wt_reader",
  ];

  if (maleOnlySlots.includes(slotKey) && gender === "female") {
    return { eligible: false, reason: "gender_restricted" };
  }

  return { eligible: true, reason: "" };
}

/**
 * Check if a slot is a student ministry part (allows both genders as performers).
 */
function isStudentPart(slotKey: string): boolean {
  return ["initial_call", "return_visit", "bible_study_demo", "bible_reading"].includes(slotKey);
}
