import type { BlackboardItem, ScheduleCandidate } from '../domain/types';
import { dedupeImportCandidates, normalizeExternalItem, normalizeScheduleEntry } from './normalize';

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

export function parseBlackboardScheduleHtml(html: string, baseUrl: string): ScheduleCandidate[] {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const elements = Array.from(document.querySelectorAll<HTMLElement>(
    '[data-course-schedule], [data-class-event], [data-weekday], [data-day-of-week], [data-start-time]',
  ));
  const schedules: ScheduleCandidate[] = [];
  for (const element of elements) {
    const attrOrText = (attributes: string[], selectors: string[]): string => {
      for (const attribute of attributes) {
        const value = element.getAttribute(attribute);
        if (value) return value;
      }
      for (const selector of selectors) {
        const value = text(element.querySelector(selector)?.textContent);
        if (value) return value;
      }
      return '';
    };
    const href = element.querySelector<HTMLAnchorElement>('a[href]')?.getAttribute('href') ?? '';
    const schedule = normalizeScheduleEntry({
      externalId: element.getAttribute('data-item-id') ?? element.getAttribute('data-id') ?? element.id ?? null,
      courseName: element.getAttribute('data-course-name') ?? text(element.querySelector('[data-course-name], .course-name, .course')?.textContent),
      courseCode: element.getAttribute('data-course-code') ?? (text(element.querySelector('[data-course-code], .course-code')?.textContent) || null),
      weekday: attrOrText(['data-weekday', 'data-day-of-week', 'data-day'], ['[data-weekday]', '[data-day-of-week]', '.weekday', '.day']),
      startTime: attrOrText(['data-start-time', 'data-start'], ['[data-start-time]', 'time[data-start]']),
      endTime: attrOrText(['data-end-time', 'data-end'], ['[data-end-time]', 'time[data-end]']),
      location: element.getAttribute('data-location') ?? text(element.querySelector('[data-location], .location, .room')?.textContent),
      sourceUrl: href ? new URL(href, baseUrl).href : baseUrl,
    });
    if (schedule) schedules.push(schedule);
  }
  const seen = new Set<string>();
  return schedules.filter((schedule) => {
    const key = schedule.externalId ?? `${schedule.courseCode ?? schedule.courseName}|${schedule.weekday}|${schedule.startTime}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
