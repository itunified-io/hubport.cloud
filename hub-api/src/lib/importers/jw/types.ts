/**
 * Shared types for JW.org import pipeline.
 */

export interface ImportedEdition {
  language: string;
  yearMonth: string;
  sourceUrl: string;
  sourcePublicationCode: string;
  checksum: string;
  weeks: ImportedWeek[];
}

export interface ImportedWeek {
  weekOf: string; // ISO date string (Monday)
  dateRange: string;
  theme: string;
  bibleReading: string;
  songNumbers: number[];
  sortOrder: number;
  parts: ImportedPart[];
}

export interface ImportedPart {
  section: "treasures" | "ministry" | "living";
  partType: string;
  title: string;
  durationMinutes: number | null;
  sourceRef: string | null;
  sourceUrl: string | null;
  requiresAssistant: boolean;
  sortOrder: number;
}

export interface ImportedStudyEdition {
  language: string;
  issueKey: string;
  checksum: string;
  weeks: ImportedStudyWeek[];
}

export interface ImportedStudyWeek {
  weekOf: string; // ISO date string (Sunday)
  articleTitle: string;
  articleUrl: string | null;
  studyNumber: number | null;
  sourceRef: string | null;
  sortOrder: number;
}

export interface ImportPreview<T> {
  edition: T;
  warnings: string[];
  existingEditionId: string | null;
  wouldReplace: boolean;
}

export interface ImportResult {
  editionId: string;
  periodId: string;
  meetingsCreated: number;
  slotsSeeded: number;
  warnings: string[];
}

export interface StudyImportResult {
  editionId: string;
  weeksCreated: number;
  meetingsLinked: number;
  warnings: string[];
}
