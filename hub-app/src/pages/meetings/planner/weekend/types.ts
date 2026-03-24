// hub-app/src/pages/meetings/planner/weekend/types.ts

export interface Publisher {
  id: string;
  firstName: string;
  lastName: string;
  displayName?: string;
}

export interface SlotTemplate {
  slotKey: string;
  label: string;
  category: string;
  sortOrder: number;
}

export interface Assignment {
  id: string;
  status: string;
  slotTemplate: SlotTemplate;
  assignee?: Publisher;
  assistant?: Publisher;
}

export interface PublicTalk {
  id: string;
  talkNumber: number;
  title: string;
}

export interface Speaker {
  id: string;
  firstName: string;
  lastName: string;
  displayName?: string;
  congregationName?: string;
  isLocal: boolean;
}

export interface TalkSchedule {
  id: string;
  mode: string; // "local" | "guest" | "exchange"
  invitationState: string; // "draft" | "invited" | "confirmed"
  speaker: Speaker;
  publicTalk?: PublicTalk;
}

export interface WeekendStudyWeek {
  articleTitle: string;
  articleUrl: string | null;
  studyNumber: number | null;
  sourceRef: string | null;
  songNumbers: number[];
}

export interface WeekendMeeting {
  id: string;
  title: string;
  date: string;
  status: string;
  weekendStudyWeek?: WeekendStudyWeek;
  assignments: Assignment[];
  talkSchedules: TalkSchedule[];
}

export interface StudyEdition {
  yearMonth: string;
  label: string;
  available: boolean;
  imported: boolean;
  importedEditionId: string | null;
  url: string | null;
  thumbnailUrl: string | null;
  issueCode: string;
}
