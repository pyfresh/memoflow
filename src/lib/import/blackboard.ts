import type { BlackboardItem } from '../domain/types';
import { dedupeImportCandidates, normalizeExternalItem } from './normalize';

function text(value: string | null | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

export function parseBlackboardCalendarHtml(html: string, baseUrl: string): BlackboardItem[] {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const elements = Array.from(document.querySelectorAll<HTMLElement>(
    '[data-calendar-item], [data-item-id], [data-due], [data-due-date], article, li, tr',
  ));
  const candidates: BlackboardItem[] = [];

  for (const element of elements) {
    const dueNode = element.querySelector<HTMLElement>('time[datetime], [data-due], [data-due-date]');
    const dueAt = dueNode?.getAttribute('datetime')
      ?? dueNode?.getAttribute('data-due')
      ?? dueNode?.getAttribute('data-due-date')
      ?? '';
    if (!dueAt) continue;

    const title = text(element.querySelector('a, h1, h2, h3, h4, strong')?.textContent);
    if (!title) continue;

    const href = element.querySelector<HTMLAnchorElement>('a[href]')?.getAttribute('href') ?? '';
    const courseName = element.getAttribute('data-course-name')
      ?? text(element.querySelector('[data-course-name], .course-name, .course')?.textContent)
      ?? '未命名课程';
    const courseCode = element.getAttribute('data-course-code')
      ?? text(element.querySelector('[data-course-code], .course-code')?.textContent)
      ?? null;
    const itemType = element.getAttribute('data-item-type')
      ?? text(element.querySelector('[data-item-type], .item-type')?.textContent)
      ?? 'other';
    const externalId = element.getAttribute('data-item-id')
      ?? element.getAttribute('data-id')
      ?? element.id
      ?? null;

    candidates.push(normalizeExternalItem({
      externalId,
      courseName,
      courseCode,
      title,
      itemType,
      dueAt,
      sourceUrl: href ? new URL(href, baseUrl).href : baseUrl,
    }));
  }

  return dedupeImportCandidates(candidates);
}
