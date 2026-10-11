export type ReminderStatus = 'pending' | 'completed' | 'ignored';
export type BlackboardItemType = 'assignment' | 'project' | 'exam' | 'event' | 'other';
export type BlackboardSourceKind = 'assignment' | 'event' | 'unknown';
export type CourseScheduleSource = 'archive' | 'blackboard';
export type NotificationChannel = 'native' | 'pushplus';
export type CountdownStatus = 'idle' | 'running' | 'paused' | 'completed';

export interface NotificationSettings {
  pushplusEnabled: boolean;
  pushplusToken: string;
}

export interface ReminderDeliveryState {
  nativeSentAt: string | null;
  pushplusSentAt: string | null;
  pushplusLastError: string | null;
}

export interface Countdown {
  id: string;
  name: string;
  totalSeconds: number;
  remainingSeconds: number;
  status: CountdownStatus;
  notificationSentAt: string | null;
  delivery?: ReminderDeliveryState;
  createdAt: string;
  updatedAt: string;
}

export interface Memo {
  id: string;
  title: string;
  richText: string;
  categoryId: string | null;
  tags: string[];
  source: 'manual' | 'blackboard';
  externalItemId: string | null;
  sourceUrl: string | null;
  sourceKind?: BlackboardSourceKind;
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
  /** When the notification should fire; falls back to dueAt for ordinary reminders. */
  notificationAt?: string;
  recurrenceRule: string | null;
  status: ReminderStatus;
  notificationSentAt: string | null;
  delivery?: ReminderDeliveryState;
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
  recurrenceRule?: string | null;
  sourceUrl: string;
  sourceKind?: BlackboardSourceKind;
  lastSeenAt?: string;
  lastPayloadHash?: string;
  syncStatus?: 'new' | 'updated' | 'existing' | 'not-found' | 'needs-review';
}

export interface CourseScheduleEntry {
  id: string;
  courseName: string;
  courseCode: string | null;
  weekday: number;
  startTime: string;
  endTime: string;
  location: string | null;
  source: CourseScheduleSource;
  externalId: string | null;
  sourceUrl: string;
  startDate?: string;
  endDate?: string;
  recurrenceRule?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleCandidate {
  externalId: string | null;
  courseName: string;
  courseCode: string | null;
  weekday: number;
  startTime: string;
  endTime: string;
  location: string | null;
  sourceUrl: string;
  startDate?: string;
  endDate?: string;
  recurrenceRule?: string | null;
}

export interface ImportCandidate extends BlackboardItem {
  localMemoContent?: string;
}

export interface BlackboardCapturePayload {
  items: ImportCandidate[];
  schedules: ScheduleCandidate[];
}

export interface CalendarCell {
  date: string;
  isCurrentMonth: boolean;
  isToday: boolean;
}

export interface CalendarItem { id: string; date: string; title: string; kind: 'course' | 'reminder' | 'note'; time?: string; status?: ReminderStatus; }
export interface RecentItem {
  searchText?: string;
  id: string;
  memoId: string;
  title: string;
  dueAt: string | null;
  source: 'manual' | 'blackboard';
  status: ReminderStatus;
  category: string;
  tags?: string[];
}


