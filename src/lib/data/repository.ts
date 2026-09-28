import { advanceReminderOccurrence, parseLocalIso } from '../domain/reminders';
import type { BlackboardItem, ImportCandidate, Memo, Reminder, ReminderStatus } from '../domain/types';

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

export function normalizeLocalDateTime(value: string): string {
  if (!value) return '';
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:Z|[+-]\d{2}:?\d{2})?$/);
  if (!match) throw new Error(`Invalid reminder date: ${value}`);
  const local = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6] ?? '00'}`;
  parseLocalIso(local);
  return `${local}+08:00`;
}
function defaultSnapshot(): AppSnapshot { return { memos: [], reminders: [], blackboardItems: [], syncRuns: [], externalMappings: [] }; }
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
function sameKey(a: BlackboardItem, b: BlackboardItem): boolean {
  const left = stableExternalKey(a); const right = stableExternalKey(b); return left !== null && left === right;
}
function remoteMemoBody(courseName: string, itemType: string, sourceUrl: string): string {
  const href = sourceUrl ? `<a href="${sourceUrl}">打开 Blackboard 项目</a>` : '';
  return `<p><strong>${courseName}</strong></p><p>${itemType}</p><p>${href}</p>`;
}

export class LocalRepository {
  constructor(private readonly storage: StorageLike, private readonly driver?: PersistenceDriver) {}
  load(): AppSnapshot {
    const raw = this.storage.getItem(STORAGE_KEY); if (!raw) return defaultSnapshot();
    try { return validateSnapshot(JSON.parse(raw)); }
    catch (error) { if (error instanceof RepositoryCorruptionError) throw error; throw new RepositoryCorruptionError(`Unable to parse snapshot: ${String(error)}`); }
  }
  async loadAsync(): Promise<AppSnapshot> {
    if (!this.driver) return this.load();
    const snapshot = validateSnapshot(await this.driver.load()); this.write(snapshot); return snapshot;
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
    for (const candidate of candidates) {
      if (!candidate.dueAt) { result.errorCount += 1; continue; }
      try { parseLocalIso(candidate.dueAt); } catch { result.errorCount += 1; continue; }
      const key = stableExternalKey(candidate); if (!key) { result.errorCount += 1; continue; }
      const mapping = (snapshot.externalMappings ?? []).find((item) => item.key === key || (item.sourceUrl && candidate.sourceUrl && item.sourceUrl.toLowerCase() === candidate.sourceUrl.toLowerCase()));
      const existing = mapping ? snapshot.blackboardItems.find((item) => item.id === mapping.externalId || sameKey(item, candidate)) : snapshot.blackboardItems.find((item) => sameKey(item, candidate));
      if (existing) {
        const oldTitle = existing.title; const changed = oldTitle !== candidate.title || existing.dueAt !== candidate.dueAt;
        Object.assign(existing, { externalId: candidate.externalId, courseName: candidate.courseName, courseCode: candidate.courseCode, title: candidate.title, itemType: candidate.itemType, dueAt: candidate.dueAt, sourceUrl: candidate.sourceUrl, lastSeenAt: nowIso(), syncStatus: changed ? 'updated' : 'existing' });
        const memo = mapping?.memoId ? snapshot.memos.find((item) => item.id === mapping.memoId) : snapshot.memos.find((item) => item.source === 'blackboard' && ((candidate.externalId && item.externalItemId === candidate.externalId) || (!candidate.externalId && item.sourceUrl === candidate.sourceUrl)));
        const reminder = mapping?.reminderId ? snapshot.reminders.find((item) => item.id === mapping.reminderId) : memo ? snapshot.reminders.find((item) => item.memoId === memo.id) : undefined;
        if (memo) { if (memo.title === oldTitle) memo.title = candidate.title; memo.updatedAt = nowIso(); }
        if (reminder) { if (reminder.title === oldTitle) reminder.title = candidate.title; reminder.dueAt = candidate.dueAt; reminder.recurrenceAnchorAt ??= candidate.dueAt; reminder.updatedAt = nowIso(); }
        if (mapping) Object.assign(mapping, { key, externalId: candidate.externalId, sourceUrl: candidate.sourceUrl, updatedAt: nowIso() }); else (snapshot.externalMappings ??= []).push({ key, externalId: candidate.externalId, sourceUrl: candidate.sourceUrl, memoId: memo?.id ?? null, reminderId: reminder?.id ?? null, updatedAt: nowIso() });
        if (changed) result.updatedCount += 1; else result.existingCount += 1; continue;
      }
      const timestamp = nowIso(); const memoId = createId('memo'); const reminderId = createId('reminder');
      const memo: Memo = { id: memoId, title: candidate.title, richText: remoteMemoBody(candidate.courseName, candidate.itemType, candidate.sourceUrl), categoryId: 'course', tags: [candidate.itemType, candidate.courseCode ?? candidate.courseName], source: 'blackboard', externalItemId: candidate.externalId, sourceUrl: candidate.sourceUrl, createdAt: timestamp, updatedAt: timestamp };
      snapshot.memos.unshift(memo); snapshot.reminders.push({ id: reminderId, memoId, title: candidate.title, dueAt: candidate.dueAt, recurrenceRule: null, status: 'pending', notificationSentAt: null, recurrenceAnchorAt: candidate.dueAt, occurrenceHistory: [], createdAt: timestamp, updatedAt: timestamp });
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





