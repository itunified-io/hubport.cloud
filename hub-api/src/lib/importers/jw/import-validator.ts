/**
 * Validates parsed import data before committing to the database.
 * Rejects partial imports that would leave planning unusable.
 */

import type { ImportedEdition, ImportedStudyEdition } from "./types.js";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a parsed workbook edition before commit.
 */
export function validateWorkbookEdition(edition: ImportedEdition): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!edition.language) {
    errors.push("Missing language");
  }
  if (!edition.yearMonth || !/^\d{4}-\d{2}$/.test(edition.yearMonth)) {
    errors.push("Invalid yearMonth format (expected YYYY-MM)");
  }
  if (!edition.weeks || edition.weeks.length === 0) {
    errors.push("No weeks parsed — import would be empty");
  }

  for (const week of edition.weeks) {
    if (!week.weekOf) {
      errors.push(`Week missing weekOf date`);
    }
    if (!week.parts || week.parts.length === 0) {
      warnings.push(`Week ${week.dateRange || week.weekOf}: no parts parsed`);
    }

    // Verify each week has at least a treasures and living section
    const sections = new Set(week.parts.map((p) => p.section));
    if (!sections.has("treasures")) {
      warnings.push(`Week ${week.dateRange || week.weekOf}: missing "Treasures" section`);
    }
    if (!sections.has("living")) {
      warnings.push(`Week ${week.dateRange || week.weekOf}: missing "Living" section`);
    }

    for (const part of week.parts) {
      if (!part.title) {
        warnings.push(`Week ${week.dateRange || week.weekOf}: part missing title`);
      }
      if (!part.partType) {
        errors.push(`Week ${week.dateRange || week.weekOf}: part missing partType`);
      }
    }
  }

  // Minimum completeness: at least 2 weeks with parts
  const weeksWithParts = edition.weeks.filter((w) => w.parts.length > 0);
  if (weeksWithParts.length < 2) {
    errors.push(
      `Only ${weeksWithParts.length} weeks have parts — minimum 2 required for a valid edition`,
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate a parsed study edition before commit.
 */
export function validateStudyEdition(edition: ImportedStudyEdition): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!edition.language) {
    errors.push("Missing language");
  }
  if (!edition.issueKey) {
    errors.push("Missing issueKey");
  }
  if (!edition.weeks || edition.weeks.length === 0) {
    errors.push("No study weeks parsed — import would be empty");
  }

  for (const week of edition.weeks) {
    if (!week.weekOf) {
      errors.push("Study week missing weekOf date");
    }
    if (!week.articleTitle) {
      warnings.push(`Study week ${week.weekOf}: missing article title`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
