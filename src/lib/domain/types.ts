export type ReminderStatus = 'pending' | 'completed' | 'ignored';
export type BlackboardItemType = 'assignment' | 'project' | 'exam' | 'event' | 'other';

export interface Memo {
  id: string;
  title: string;
  richText: string;
  categoryId: string | null;
  tags: string[];
  source: 'manual' | 'blackboard';
  externalItemId: string | null;
  sourceUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderOccurrence {
  at: string;
  status: 'completed' | 'ignored';
}

export interface Reminder {
  id: string;
  memoId: string | null;
  title: string;
  dueAt: string;
  recurrenceRule: string | null;
  status: ReminderStatus;
  notificationSentAt: string | null;
  recurrenceAnchorAt?: string;
  occurrenceHistory?: ReminderOccurrence[];
  createdAt: string;
  updatedAt: string;
}

export interface BlackboardItem {
  id?: string;
  externalId: string | null;
  courseName: string;
  courseCode: string | null;
  title: string;
  itemType: BlackboardItemType;
  dueAt: string | null;
  sourceUrl: string;
  lastSeenAt?: string;
  lastPayloadHash?: string;
  syncStatus?: 'new' | 'updated' | 'existing' | 'not-found' | 'needs-review';
}

export interface ImportCandidate extends BlackboardItem {
  localMemoContent?: string;
}

export interface CalendarCell {
  date: string;
  isCurrentMonth: boolean;
  isToday: boolean;
}

export interface CalendarItem { id: string; date: string; title: string; kind: 'course' | 'reminder' | 'note'; time?: string; }
export interface RecentItem {
  searchText?: string; id: string; memoId: string; title: string; dueAt: string | null; source: 'manual' | 'blackboard'; status: ReminderStatus; category: string; }


