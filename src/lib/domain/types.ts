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

export interface Reminder {
  id: string;
  memoId: string | null;
  title: string;
  dueAt: string;
  recurrenceRule: string | null;
  status: ReminderStatus;
  notificationSentAt: string | null;
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
