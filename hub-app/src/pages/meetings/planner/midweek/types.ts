// hub-app/src/pages/meetings/planner/midweek/types.ts

export interface WorkbookPart {
  id: string;
  section: string;
  partType: string;
  title: string;
  durationMinutes: number | null;
  sourceRef: string | null;
  sourceUrl: string | null;
  requiresAssistant: boolean;
}

export interface MeetingPeriod {
  id: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string;
  meetings: PeriodMeeting[];
}

export interface PeriodMeeting {
  id: string;
  title: string;
  date: string;
  status: string;
  workbookWeek?: {
    theme: string;
    dateRange: string;
    bibleReading?: string;
    songNumbers: number[];
    parts: WorkbookPart[];
  };
  assignments: Assignment[];
}

export interface Assignment {
  id: string;
  status: string;
  slotTemplate: {
    slotKey: string;
    label: string;
    category: string;
    sortOrder: number;
  };
  workbookPart?: WorkbookPart;
  assignee?: Publisher;
  assistant?: Publisher;
}

export interface Publisher {
  id: string;
  firstName: string;
  lastName: string;
  displayName?: string;
}

export interface AvailableEdition {
  yearMonth: string;
  label: string;
  available: boolean;
  imported: boolean;
  importedEditionId: string | null;
  url: string | null;
  thumbnailUrl: string | null;
  issueCode: string;
}
