import { advanceReminderOccurrence, parseLocalIso } from '../domain/reminders';
import type { BlackboardItem, CourseScheduleEntry, ImportCandidate, Memo, Reminder, ReminderStatus, ScheduleCandidate } from '../domain/types';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}
export interface SyncRun {
  id: string; startedAt: string; finishedAt: string;
  status: 'completed' | 'completed-with-errors';
  newCount: number; updatedCount: number; existingCount: number; errorCount: number;
}
export interface ExternalMapping {
  key: string; externalId: string | null; memoId: string | null; reminderId: string | null;
  sourceUrl: string; updatedAt: string;
}
export interface AppSnapshot {
  memos: Memo[]; reminders: Reminder[]; blackboardItems: BlackboardItem[];
  courseSchedules?: CourseScheduleEntry[];
  syncRuns?: SyncRun[]; externalMappings?: ExternalMapping[];
}
export interface MemoDraft {
  standalone?: boolean;
  id?: string; title: string; body: string; reminderAt: string; recurrenceRule: string | null;
  categoryId?: string | null; tags?: string[]; source?: 'manual' | 'blackboard';
  externalItemId?: string | null; sourceUrl?: string | null;
}
export interface ReminderDraft {
  id?: string; title: string; dueAt: string; recurrenceRule: string | null; memoId?: string | null;
}
export interface SavedMemo extends Memo { reminderId: string | null; }
export interface ImportResult { newCount: number; updatedCount: number; existingCount: number; errorCount: number; }
export interface ScheduleImportResult { newCount: number; updatedCount: number; existingCount: number; }
export interface DemoSeedResult { addedMemos: number; addedReminders: number; addedBlackboardItems: number; addedSchedules: number; }
export interface PersistenceDriver { load(): Promise<AppSnapshot>; save(snapshot: AppSnapshot): Promise<void>; }

export class RepositoryCorruptionError extends Error {
  constructor(message: string) { super(message); this.name = 'RepositoryCorruptionError'; }
}
const STORAGE_KEY = 'memoflow.snapshot.v1';
function createId(prefix: string): string {
  const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${uuid}`;
}
function nowIso(): string { return new Date().toISOString(); }
function demoDueAt(referenceDate: Date, day: number, hour: string): string {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
  return `${date}T${hour}:00+08:00`;
}

export function normalizeLocalDateTime(value: string): string {
  if (!value) return '';
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:Z|[+-]\d{2}:?\d{2})?$/);
  if (!match) throw new Error(`Invalid reminder date: ${value}`);
  const local = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] ?? '00'}`;
  parseLocalIso(local);
  return `${local}+08:00`;
}
function defaultSnapshot(): AppSnapshot { return { memos: [], reminders: [], blackboardItems: [], courseSchedules: [], syncRuns: [], externalMappings: [] }; }
function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new RepositoryCorruptionError(`Invalid snapshot field ${path}`);
  return value;
}
function validateSnapshot(input: unknown): AppSnapshot {
  if (!input || typeof input !== 'object') throw new RepositoryCorruptionError('Snapshot must be an object');
  const parsed = input as Partial<AppSnapshot>;
  if (!Array.isArray(parsed.memos) || !Array.isArray(parsed.reminders) || !Array.isArray(parsed.blackboardItems)) throw new RepositoryCorruptionError('Snapshot is missing required arrays');
  for (const memo of parsed.memos) {
    if (!memo || typeof memo !== 'object') throw new RepositoryCorruptionError('Invalid memo record');
    requireString(memo.id, 'memos[].id'); requireString(memo.title, 'memos[].title'); requireString(memo.richText, 'memos[].richText');
    if (!Array.isArray(memo.tags)) throw new RepositoryCorruptionError('Invalid memo tags');
  }
  for (const reminder of parsed.reminders) {
    if (!reminder || typeof reminder !== 'object') throw new RepositoryCorruptionError('Invalid reminder record');
    requireString(reminder.id, 'reminders[].id'); requireString(reminder.dueAt, 'reminders[].dueAt'); parseLocalIso(reminder.dueAt);
  }
  return {
    memos: parsed.memos as Memo[], reminders: parsed.reminders as Reminder[], blackboardItems: parsed.blackboardItems as BlackboardItem[],
    courseSchedules: Array.isArray(parsed.courseSchedules) ? parsed.courseSchedules as CourseScheduleEntry[] : [],
    syncRuns: Array.isArray(parsed.syncRuns) ? parsed.syncRuns as SyncRun[] : [],
    externalMappings: Array.isArray(parsed.externalMappings) ? parsed.externalMappings as ExternalMapping[] : [],
  };
}
function stableExternalKey(item: Pick<BlackboardItem, 'externalId' | 'sourceUrl' | 'courseName' | 'courseCode' | 'title' | 'itemType'>): string | null {
  if (item.externalId?.trim()) return `id:${item.externalId.trim()}`;
  if (item.sourceUrl?.trim()) return `url:${item.sourceUrl.trim().toLowerCase()}`;
  const course = (item.courseCode || item.courseName || '').trim().toLowerCase();
  const title = (item.title || '').trim().toLowerCase();
  if (!course || !title) return null;
  return `fallback:${course}|${item.itemType}|${title}`;
}
function stableScheduleKey(item: Pick<ScheduleCandidate, 'externalId' | 'courseName' | 'courseCode' | 'weekday' | 'startTime' | 'endTime'>): string {
  if (item.externalId?.trim()) return `id:${item.externalId.trim()}`;
  return `fallback:${(item.courseCode || item.courseName).trim().toLowerCase()}|${item.weekday}|${item.startTime}|${item.endTime}`;
}
function sameKey(a: BlackboardItem, b: BlackboardItem): boolean {
  const left = stableExternalKey(a); const right = stableExternalKey(b); return left !== null && left === right;
}
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character));
}
function remoteMemoBody(courseName: string, itemType: string, sourceUrl: string, description?: string): string {
  const href = sourceUrl ? `<a href="${escapeHtml(sourceUrl)}">打开 Blackboard 项目</a>` : '';
  const body = description?.trim() ? `<p>${escapeHtml(description.trim()).replace(/\r?\n/g, '<br>')}</p>` : `<p>${escapeHtml(itemType)}</p>`;
  return `<p><strong>${escapeHtml(courseName)}</strong></p>${body}<p>${href}</p>`;
}
function isLegacyBlackboardPlaceholder(item: BlackboardItem): boolean {
  const sourceUrl = item.sourceUrl.trim().toLowerCase();
  return /^\d{1,2}$/.test(item.title.trim())
    && item.itemType === 'other'
    && (item.courseName.trim() === '未命名课程' || item.courseName.trim() === 'Blackboard 课程')
    && /^https:\/\/(?:bb|sts)\.cuhk\.edu\.cn(?:\/|$)/.test(sourceUrl);
}
function removeLegacyBlackboardPlaceholders(snapshot: AppSnapshot): boolean {
  const legacyItems = snapshot.blackboardItems.filter(isLegacyBlackboardPlaceholder);
  if (!legacyItems.length) return false;
  const legacyKeys = new Set(legacyItems.flatMap((item) => [item.id, stableExternalKey(item)]).filter((key): key is string => Boolean(key)));
  const mappings = snapshot.externalMappings ?? [];
  const legacyMappings = mappings.filter((mapping) => legacyKeys.has(mapping.key) || (mapping.externalId ? legacyKeys.has(mapping.externalId) : false) || legacyItems.some((item) => item.sourceUrl.toLowerCase() === mapping.sourceUrl.toLowerCase()));
  const memoIds = new Set(legacyMappings.map((mapping) => mapping.memoId).filter((id): id is string => Boolean(id)));
  const reminderIds = new Set(legacyMappings.map((mapping) => mapping.reminderId).filter((id): id is string => Boolean(id)));
  const legacyMemoIds = new Set(legacyItems.map((item) => item.id).filter((id): id is string => Boolean(id)));
  snapshot.blackboardItems = snapshot.blackboardItems.filter((item) => !isLegacyBlackboardPlaceholder(item));
  snapshot.externalMappings = mappings.filter((mapping) => !legacyMappings.includes(mapping));
  snapshot.memos = snapshot.memos.filter((memo) => !memoIds.has(memo.id) && !legacyMemoIds.has(memo.id) && !(memo.source === 'blackboard' && legacyItems.some((item) => memo.title === item.title && (memo.sourceUrl ?? '').toLowerCase() === item.sourceUrl.toLowerCase())));
  snapshot.reminders = snapshot.reminders.filter((reminder) => !reminderIds.has(reminder.id) && !memoIds.has(reminder.memoId ?? ''));
  return true;
}

export class LocalRepository {
  constructor(private readonly storage: StorageLike, private readonly driver?: PersistenceDriver) {}
  load(): AppSnapshot {
    const raw = this.storage.getItem(STORAGE_KEY); if (!raw) return defaultSnapshot();
    try {
      const snapshot = validateSnapshot(JSON.parse(raw));
      if (removeLegacyBlackboardPlaceholders(snapshot)) this.write(snapshot);
      return snapshot;
    }
    catch (error) { if (error instanceof RepositoryCorruptionError) throw error; throw new RepositoryCorruptionError(`Unable to parse snapshot: ${String(error)}`); }
  }
  async loadAsync(): Promise<AppSnapshot> {
    if (!this.driver) return this.load();
    const snapshot = validateSnapshot(await this.driver.load());
    const migrated = removeLegacyBlackboardPlaceholders(snapshot);
    this.write(snapshot);
    if (migrated) await this.driver.save(snapshot);
    return snapshot;
  }
  private write(snapshot: AppSnapshot): void { this.storage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); }
  async flush(): Promise<void> { if (this.driver) await this.driver.save(this.load()); }
  replaceSnapshot(snapshot: AppSnapshot): void { this.write(validateSnapshot(snapshot)); }
  async replaceSnapshotAsync(snapshot: AppSnapshot): Promise<void> { const valid = validateSnapshot(snapshot); this.write(valid); if (this.driver) await this.driver.save(valid); }

  saveMemoDraft(draft: MemoDraft): SavedMemo {
    const snapshot = this.load(); const timestamp = nowIso();
    const existingMemo = draft.id ? snapshot.memos.find((item) => item.id === draft.id) : undefined;
    const memoId = existingMemo?.id ?? createId('memo');
    const memo: Memo = existingMemo ?? {
      id: memoId, title: draft.title.trim(), richText: draft.body, categoryId: draft.categoryId ?? null, tags: [...(draft.tags ?? [])],
      source: draft.source ?? 'manual', externalItemId: draft.externalItemId ?? null, sourceUrl: draft.sourceUrl ?? null, createdAt: timestamp, updatedAt: timestamp,
    };
    if (existingMemo) Object.assign(existingMemo, {
      title: draft.title.trim(), richText: draft.body, updatedAt: timestamp,
      ...(draft.categoryId !== undefined ? { categoryId: draft.categoryId } : {}),
      ...(draft.tags !== undefined ? { tags: [...draft.tags] } : {}),
    }); else snapshot.memos.unshift(memo);

    let reminderId: string | null = snapshot.reminders.find((item) => item.memoId === memoId)?.id ?? null;
    if (draft.reminderAt) {
      const reminder = this.saveReminderDraft({ id: reminderId ?? undefined, title: draft.title.trim(), dueAt: draft.reminderAt, recurrenceRule: draft.recurrenceRule, memoId }, snapshot, timestamp);
      reminderId = reminder.id;
    } else if (reminderId) { snapshot.reminders = snapshot.reminders.filter((item) => item.id !== reminderId); reminderId = null; }
    this.write(snapshot); return { ...memo, reminderId };
  }

  saveReminderDraft(draft: ReminderDraft, existingSnapshot?: AppSnapshot, timestamp = nowIso()): Reminder {
    if (!draft.title.trim()) throw new Error('Reminder title is required');
    const dueAt = normalizeLocalDateTime(draft.dueAt); const snapshot = existingSnapshot ?? this.load();
    const existing = draft.id ? snapshot.reminders.find((item) => item.id === draft.id) : undefined;
    const reminder: Reminder = existing ?? {
      id: createId('reminder'), memoId: draft.memoId ?? null, title: draft.title.trim(), dueAt, recurrenceRule: draft.recurrenceRule, status: 'pending', notificationSentAt: null,
      recurrenceAnchorAt: dueAt, occurrenceHistory: [], createdAt: timestamp, updatedAt: timestamp,
    };
    if (existing) Object.assign(existing, { title: draft.title.trim(), dueAt, recurrenceRule: draft.recurrenceRule, memoId: draft.memoId ?? existing.memoId, notificationSentAt: null, status: 'pending', recurrenceAnchorAt: existing.recurrenceAnchorAt ?? dueAt, updatedAt: timestamp });
    else snapshot.reminders.push(reminder);
    if (!existingSnapshot) this.write(snapshot); return reminder;
  }

  setReminderStatus(reminderId: string, status: ReminderStatus): void {
    const snapshot = this.load(); const reminder = snapshot.reminders.find((item) => item.id === reminderId); if (!reminder) return;
    if (reminder.recurrenceRule && (status === 'completed' || status === 'ignored')) {
      reminder.occurrenceHistory = [...(reminder.occurrenceHistory ?? []), { at: reminder.dueAt, status }];
      reminder.dueAt = advanceReminderOccurrence(reminder); reminder.status = 'pending'; reminder.notificationSentAt = null;
    } else reminder.status = status;
    reminder.updatedAt = nowIso(); this.write(snapshot);
  }
  updateMemo(id: string, updates: Partial<Pick<Memo, 'title' | 'richText' | 'categoryId' | 'tags'>>): void {
    const snapshot = this.load(); const memo = snapshot.memos.find((item) => item.id === id); if (!memo) return;
    Object.assign(memo, updates, { updatedAt: nowIso() }); this.write(snapshot);
  }
  deleteMemo(id: string): void {
    const snapshot = this.load(); snapshot.memos = snapshot.memos.filter((memo) => memo.id !== id); snapshot.reminders = snapshot.reminders.filter((reminder) => reminder.memoId !== id); snapshot.externalMappings = (snapshot.externalMappings ?? []).filter((mapping) => mapping.memoId !== id); this.write(snapshot);
  }
  deleteReminder(id: string): void {
    const snapshot = this.load(); snapshot.reminders = snapshot.reminders.filter((reminder) => reminder.id !== id); snapshot.externalMappings = (snapshot.externalMappings ?? []).filter((mapping) => mapping.reminderId !== id); this.write(snapshot);
  }

  importBlackboardItems(candidates: ImportCandidate[]): ImportResult {
    const snapshot = this.load(); snapshot.syncRuns ??= []; snapshot.externalMappings ??= []; const startedAt = nowIso(); const result: ImportResult = { newCount: 0, updatedCount: 0, existingCount: 0, errorCount: 0 };
    removeLegacyBlackboardPlaceholders(snapshot);
    for (const candidate of candidates) {
      if (!candidate.dueAt) { result.errorCount += 1; continue; }
      try { parseLocalIso(candidate.dueAt); } catch { result.errorCount += 1; continue; }
      const key = stableExternalKey(candidate); if (!key) { result.errorCount += 1; continue; }
      const mapping = (snapshot.externalMappings ?? []).find((item) => item.key === key || (item.sourceUrl && candidate.sourceUrl && item.sourceUrl.toLowerCase() === candidate.sourceUrl.toLowerCase()));
      const existing = mapping ? snapshot.blackboardItems.find((item) => item.id === mapping.externalId || sameKey(item, candidate)) : snapshot.blackboardItems.find((item) => sameKey(item, candidate));
      if (existing) {
        const oldTitle = existing.title; const dueChanged = existing.dueAt !== candidate.dueAt; const recurrenceChanged = (existing.recurrenceRule ?? null) !== (candidate.recurrenceRule ?? null); const changed = oldTitle !== candidate.title || dueChanged || recurrenceChanged;
        Object.assign(existing, { externalId: candidate.externalId, courseName: candidate.courseName, courseCode: candidate.courseCode, title: candidate.title, itemType: candidate.itemType, dueAt: candidate.dueAt, recurrenceRule: candidate.recurrenceRule ?? null, sourceUrl: candidate.sourceUrl, lastSeenAt: nowIso(), syncStatus: changed ? 'updated' : 'existing' });
        const memo = mapping?.memoId ? snapshot.memos.find((item) => item.id === mapping.memoId) : snapshot.memos.find((item) => item.source === 'blackboard' && ((candidate.externalId && item.externalItemId === candidate.externalId) || (!candidate.externalId && item.sourceUrl === candidate.sourceUrl)));
        const reminder = mapping?.reminderId ? snapshot.reminders.find((item) => item.id === mapping.reminderId) : memo ? snapshot.reminders.find((item) => item.memoId === memo.id) : undefined;
        if (memo) { if (memo.title === oldTitle) memo.title = candidate.title; memo.updatedAt = nowIso(); }
        if (reminder) { if (reminder.title === oldTitle) reminder.title = candidate.title; reminder.dueAt = candidate.dueAt; reminder.recurrenceRule = candidate.recurrenceRule ?? null; reminder.recurrenceAnchorAt ??= candidate.dueAt; if (dueChanged || recurrenceChanged) { reminder.notificationSentAt = null; reminder.status = 'pending'; } reminder.updatedAt = nowIso(); }
        if (mapping) Object.assign(mapping, { key, externalId: candidate.externalId, sourceUrl: candidate.sourceUrl, updatedAt: nowIso() }); else (snapshot.externalMappings ??= []).push({ key, externalId: candidate.externalId, sourceUrl: candidate.sourceUrl, memoId: memo?.id ?? null, reminderId: reminder?.id ?? null, updatedAt: nowIso() });
        if (changed) result.updatedCount += 1; else result.existingCount += 1; continue;
      }
      const timestamp = nowIso(); const memoId = createId('memo'); const reminderId = createId('reminder');
      const memo: Memo = { id: memoId, title: candidate.title, richText: remoteMemoBody(candidate.courseName, candidate.itemType, candidate.sourceUrl, candidate.localMemoContent), categoryId: 'course', tags: [candidate.itemType, candidate.courseCode ?? candidate.courseName], source: 'blackboard', externalItemId: candidate.externalId, sourceUrl: candidate.sourceUrl, createdAt: timestamp, updatedAt: timestamp };
      snapshot.memos.unshift(memo); snapshot.reminders.push({ id: reminderId, memoId, title: candidate.title, dueAt: candidate.dueAt, recurrenceRule: candidate.recurrenceRule ?? null, status: 'pending', notificationSentAt: null, recurrenceAnchorAt: candidate.dueAt, occurrenceHistory: [], createdAt: timestamp, updatedAt: timestamp });
      snapshot.blackboardItems.push({ ...candidate, id: key, lastSeenAt: timestamp, syncStatus: 'new' }); snapshot.externalMappings.push({ key, externalId: candidate.externalId, memoId, reminderId, sourceUrl: candidate.sourceUrl, updatedAt: timestamp }); result.newCount += 1;
    }
    if (candidates.length > 0) {
      const seenKeys = new Set(candidates.map((candidate) => stableExternalKey(candidate)).filter((key): key is string => Boolean(key)));
      for (const item of snapshot.blackboardItems) {
        const itemKey = stableExternalKey(item);
        if (itemKey && !seenKeys.has(itemKey)) item.syncStatus = 'not-found';
      }
    }
    const finishedAt = nowIso(); (snapshot.syncRuns ??= []).unshift({ id: createId('sync'), startedAt, finishedAt, status: result.errorCount ? 'completed-with-errors' : 'completed', ...result }); this.write(snapshot); return result;
  }

  seedDemoData(referenceDate = new Date()): DemoSeedResult {
    const snapshot = this.load();
    const timestamp = nowIso();
    const memoDefinitions: Memo[] = [
      { id: 'demo-memo-course', title: '线性代数项目规划', richText: '<p>整理项目分工，完成第一次讨论。</p>', categoryId: 'course', tags: ['课程', '项目'], source: 'manual', externalItemId: null, sourceUrl: null, createdAt: timestamp, updatedAt: timestamp },
      { id: 'demo-memo-life', title: '周末采购清单', richText: '<p>咖啡豆、洗衣液和水果。</p>', categoryId: 'life', tags: ['生活'], source: 'manual', externalItemId: null, sourceUrl: null, createdAt: timestamp, updatedAt: timestamp },
      { id: 'demo-memo-inbox', title: '待整理：阅读笔记', richText: '<p>把本周读到的文章整理成卡片。</p>', categoryId: 'inbox', tags: ['待整理'], source: 'manual', externalItemId: null, sourceUrl: null, createdAt: timestamp, updatedAt: timestamp },
      { id: 'demo-memo-blackboard', title: '数据结构作业提交', richText: remoteMemoBody('数据结构', 'assignment', 'https://bb.cuhk.edu.cn/ultra/courses/demo/outline'), categoryId: 'course', tags: ['assignment', 'COMP'], source: 'blackboard', externalItemId: 'demo-bb-assignment', sourceUrl: 'https://bb.cuhk.edu.cn/ultra/courses/demo/outline', createdAt: timestamp, updatedAt: timestamp },
    ];
    const reminderDefinitions: Reminder[] = [
      { id: 'demo-reminder-course', memoId: 'demo-memo-course', title: '线性代数项目规划', dueAt: demoDueAt(referenceDate, 3, '09:00'), recurrenceRule: null, status: 'pending', notificationSentAt: null, recurrenceAnchorAt: demoDueAt(referenceDate, 3, '09:00'), occurrenceHistory: [], createdAt: timestamp, updatedAt: timestamp },
      { id: 'demo-reminder-life', memoId: 'demo-memo-life', title: '周末采购清单', dueAt: demoDueAt(referenceDate, 8, '18:30'), recurrenceRule: null, status: 'pending', notificationSentAt: null, recurrenceAnchorAt: demoDueAt(referenceDate, 8, '18:30'), occurrenceHistory: [], createdAt: timestamp, updatedAt: timestamp },
      { id: 'demo-reminder-inbox', memoId: 'demo-memo-inbox', title: '待整理：阅读笔记', dueAt: demoDueAt(referenceDate, 15, '20:00'), recurrenceRule: null, status: 'pending', notificationSentAt: null, recurrenceAnchorAt: demoDueAt(referenceDate, 15, '20:00'), occurrenceHistory: [], createdAt: timestamp, updatedAt: timestamp },
      { id: 'demo-reminder-blackboard', memoId: 'demo-memo-blackboard', title: '数据结构作业提交', dueAt: demoDueAt(referenceDate, 20, '23:59'), recurrenceRule: null, status: 'pending', notificationSentAt: null, recurrenceAnchorAt: demoDueAt(referenceDate, 20, '23:59'), occurrenceHistory: [], createdAt: timestamp, updatedAt: timestamp },
      { id: 'demo-reminder-standalone', memoId: null, title: '给导师发周报', dueAt: demoDueAt(referenceDate, 10, '10:00'), recurrenceRule: null, status: 'pending', notificationSentAt: null, recurrenceAnchorAt: demoDueAt(referenceDate, 10, '10:00'), occurrenceHistory: [], createdAt: timestamp, updatedAt: timestamp },
      { id: 'demo-reminder-completed', memoId: null, title: '提交社团报名表', dueAt: demoDueAt(referenceDate, 25, '16:00'), recurrenceRule: null, status: 'completed', notificationSentAt: timestamp, recurrenceAnchorAt: demoDueAt(referenceDate, 25, '16:00'), occurrenceHistory: [], createdAt: timestamp, updatedAt: timestamp },
    ];
    const scheduleDefinitions: CourseScheduleEntry[] = [
      { id: 'demo-schedule-math', courseName: 'MATH 101', courseCode: 'MATH101', weekday: 2, startTime: '09:00', endTime: '10:30', location: 'YIA LT6', source: 'blackboard', externalId: 'demo-class-math', sourceUrl: 'https://bb.cuhk.edu.cn/ultra/courses/demo/math', createdAt: timestamp, updatedAt: timestamp },
      { id: 'demo-schedule-csc', courseName: 'CSC 201', courseCode: 'CSC201', weekday: 4, startTime: '14:30', endTime: '16:00', location: 'SHB 833', source: 'blackboard', externalId: 'demo-class-csc', sourceUrl: 'https://bb.cuhk.edu.cn/ultra/courses/demo/csc', createdAt: timestamp, updatedAt: timestamp },
    ];
    let addedMemos = 0;
    for (const memo of memoDefinitions) {
      if (snapshot.memos.some((item) => item.id === memo.id)) continue;
      snapshot.memos.push(memo);
      addedMemos += 1;
    }
    let addedReminders = 0;
    for (const reminder of reminderDefinitions) {
      if (snapshot.reminders.some((item) => item.id === reminder.id)) continue;
      snapshot.reminders.push(reminder);
      addedReminders += 1;
    }
    snapshot.courseSchedules ??= [];
    let addedSchedules = 0;
    for (const schedule of scheduleDefinitions) {
      if (!snapshot.courseSchedules.some((item) => item.id === schedule.id || stableScheduleKey(item) === stableScheduleKey(schedule))) {
        snapshot.courseSchedules.push(schedule);
        addedSchedules += 1;
      }
    }
    const blackboardItem: BlackboardItem = {
      id: 'demo-bb-assignment', externalId: 'demo-bb-assignment', courseName: '数据结构', courseCode: 'COMP 2411', title: '数据结构作业提交', itemType: 'assignment',
      dueAt: demoDueAt(referenceDate, 20, '23:59'), sourceUrl: 'https://bb.cuhk.edu.cn/ultra/courses/demo/outline', lastSeenAt: timestamp, syncStatus: 'new',
    };
    let addedBlackboardItems = 0;
    if (!snapshot.blackboardItems.some((item) => item.id === blackboardItem.id || item.externalId === blackboardItem.externalId)) {
      snapshot.blackboardItems.push(blackboardItem);
      snapshot.externalMappings ??= [];
      snapshot.externalMappings.push({ key: 'id:demo-bb-assignment', externalId: 'demo-bb-assignment', memoId: 'demo-memo-blackboard', reminderId: 'demo-reminder-blackboard', sourceUrl: blackboardItem.sourceUrl, updatedAt: timestamp });
      addedBlackboardItems = 1;
    }
    this.write(snapshot);
    return { addedMemos, addedReminders, addedBlackboardItems, addedSchedules };
  }

  importBlackboardSchedules(candidates: ScheduleCandidate[]): ScheduleImportResult {
    const snapshot = this.load();
    snapshot.courseSchedules ??= [];
    const result: ScheduleImportResult = { newCount: 0, updatedCount: 0, existingCount: 0 };
    for (const candidate of candidates) {
      const key = stableScheduleKey(candidate);
      const existing = snapshot.courseSchedules.find((item) => stableScheduleKey(item) === key);
      if (existing) {
        const changed = existing.courseName !== candidate.courseName || existing.courseCode !== candidate.courseCode || existing.weekday !== candidate.weekday || existing.startTime !== candidate.startTime || existing.endTime !== candidate.endTime || existing.location !== candidate.location || existing.sourceUrl !== candidate.sourceUrl;
        if (changed) {
          Object.assign(existing, candidate, { updatedAt: nowIso() });
          result.updatedCount += 1;
        } else result.existingCount += 1;
        continue;
      }
      const timestamp = nowIso();
      snapshot.courseSchedules.push({ ...candidate, id: `schedule_${candidate.externalId ?? createId('course')}`, source: 'blackboard', createdAt: timestamp, updatedAt: timestamp });
      result.newCount += 1;
    }
    this.write(snapshot);
    return result;
  }
  listReminders(): Reminder[] { return this.load().reminders; }
  markNotificationSent(id: string, sentAt: string): void { const snapshot = this.load(); const reminder = snapshot.reminders.find((item) => item.id === id); if (!reminder) return; reminder.notificationSentAt = sentAt; reminder.updatedAt = sentAt; this.write(snapshot); }
  clear(): void { this.storage.removeItem?.(STORAGE_KEY); }
}
export function createBrowserRepository(driver?: PersistenceDriver): LocalRepository {
  let memoryValue: string | null = null;
  const storage: StorageLike = typeof window !== 'undefined' ? window.localStorage : { getItem() { return memoryValue; }, setItem(_key, value) { memoryValue = value; }, removeItem() { memoryValue = null; } };
  return new LocalRepository(storage, driver);
}
export { stableExternalKey };





