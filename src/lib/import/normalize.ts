import { parseLocalIso } from '../domain/reminders';
import type { BlackboardItem, BlackboardItemType, ImportCandidate } from '../domain/types';

export interface RawBlackboardItem {
  externalId?: string | null; courseName?: string | null; courseCode?: string | null; title?: string | null;
  itemType?: string | null; dueAt?: string | null; sourceUrl?: string | null;
}
const typeMap: Record<string, BlackboardItemType> = {
  assignment: 'assignment', homework: 'assignment', project: 'project', exam: 'exam', test: 'exam', event: 'event', activity: 'event',
};
function normalizeType(value: string | null | undefined): BlackboardItemType { return typeMap[(value ?? '').trim().toLowerCase()] ?? 'other'; }

function normalizeDueAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const local = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (local) {
    const candidate = `${local[1]}-${local[2]}-${local[3]}T${local[4]}:${local[5]}:${local[6] ?? '00'}`;
    try { parseLocalIso(candidate); } catch { return null; }
    return `${candidate}+08:00`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(parsed);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}+08:00`;
}
export function normalizeExternalItem(raw: RawBlackboardItem): BlackboardItem {
  return { externalId: raw.externalId?.trim() || null, courseName: raw.courseName?.trim() || '未命名课程', courseCode: raw.courseCode?.trim() || null, title: raw.title?.trim() || '未命名项目', itemType: normalizeType(raw.itemType), dueAt: normalizeDueAt(raw.dueAt), sourceUrl: raw.sourceUrl?.trim() || '' };
}
export function stableImportKey(item: Pick<BlackboardItem, 'externalId' | 'sourceUrl' | 'courseName' | 'courseCode' | 'title' | 'itemType'>): string | null {
  if (item.externalId?.trim()) return `id:${item.externalId.trim()}`;
  if (item.sourceUrl?.trim()) return `url:${item.sourceUrl.trim().toLowerCase()}`;
  const course = (item.courseCode || item.courseName || '').trim().toLowerCase();
  const title = (item.title || '').trim().toLowerCase();
  if (!course || !title) return null;
  return `fallback:${course}|${item.itemType}|${title}`;
}
function sameExternalItem(a: BlackboardItem, b: BlackboardItem): boolean {
  const left = stableImportKey(a); const right = stableImportKey(b); return left !== null && left === right;
}
export function classifyImportCandidate(candidate: ImportCandidate, existing: ImportCandidate[]): BlackboardItem['syncStatus'] {
  const match = existing.find((item) => sameExternalItem(candidate, item));
  if (!match) return 'new';
  return match.title === candidate.title && match.dueAt === candidate.dueAt ? 'existing' : 'updated';
}
export function dedupeImportCandidates(candidates: BlackboardItem[]): BlackboardItem[] {
  const deduped = new Map<string, BlackboardItem>();
  const noKey: BlackboardItem[] = [];
  for (const candidate of candidates) {
    const key = stableImportKey(candidate);
    if (key) deduped.set(key, candidate); else noKey.push(candidate);
  }
  return [...deduped.values(), ...noKey];
}
