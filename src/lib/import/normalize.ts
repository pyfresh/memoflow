import type { BlackboardItem, BlackboardItemType, ImportCandidate } from '../domain/types';

export interface RawBlackboardItem {
  externalId?: string | null;
  courseName?: string | null;
  courseCode?: string | null;
  title?: string | null;
  itemType?: string | null;
  dueAt?: string | null;
  sourceUrl?: string | null;
}

const typeMap: Record<string, BlackboardItemType> = {
  assignment: 'assignment',
  homework: 'assignment',
  project: 'project',
  exam: 'exam',
  test: 'exam',
  event: 'event',
  activity: 'event',
};

function normalizeType(value: string | null | undefined): BlackboardItemType {
  return typeMap[(value ?? '').trim().toLowerCase()] ?? 'other';
}

function normalizeDueAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (iso) {
    const [, year, month, day, hour, minute, second = '00'] = iso;
    return `${year}-${month}-${day}T${hour}:${minute}:${second}+08:00`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function normalizeExternalItem(raw: RawBlackboardItem): BlackboardItem {
  return {
    externalId: raw.externalId?.trim() || null,
    courseName: raw.courseName?.trim() || '未命名课程',
    courseCode: raw.courseCode?.trim() || null,
    title: raw.title?.trim() || '未命名项目',
    itemType: normalizeType(raw.itemType),
    dueAt: normalizeDueAt(raw.dueAt),
    sourceUrl: raw.sourceUrl?.trim() || '',
  };
}

function fallbackKey(item: BlackboardItem): string {
  return [item.sourceUrl, item.courseCode ?? item.courseName, item.title, item.dueAt ?? ''].join('|').toLowerCase();
}

function sameExternalItem(a: BlackboardItem, b: BlackboardItem): boolean {
  if (a.externalId && b.externalId) return a.externalId === b.externalId;
  return fallbackKey(a) === fallbackKey(b);
}

export function classifyImportCandidate(candidate: ImportCandidate, existing: ImportCandidate[]): BlackboardItem['syncStatus'] {
  const match = existing.find((item) => sameExternalItem(candidate, item));
  if (!match) return 'new';
  return match.title === candidate.title && match.dueAt === candidate.dueAt ? 'existing' : 'updated';
}

export function dedupeImportCandidates(candidates: BlackboardItem[]): BlackboardItem[] {
  const deduped = new Map<string, BlackboardItem>();
  for (const candidate of candidates) {
    deduped.set(candidate.externalId ? `id:${candidate.externalId}` : `fallback:${fallbackKey(candidate)}`, candidate);
  }
  return [...deduped.values()];
}
