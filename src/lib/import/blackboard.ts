import type { BlackboardItem, ScheduleCandidate } from '../domain/types';
import { dedupeImportCandidates, normalizeExternalItem, normalizeScheduleEntry } from './normalize';

function text(value: string | null | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

const calendarEventSelector = [
  '[data-calendar-item]', '[data-item-id]', '[data-due]', '[data-due-date]', '[data-event-id]', '[data-event]',
  '[data-start]', '.calendarEvent', '.calendar-event', '.eventItem', '.fc-event', '.fc-day-grid-event', '.fc-time-grid-event',
  '[class*="calendarEvent"]', '[class*="calendar-event"]', 'a.event', '[class~="event"]', 'a[href*="/calendar/event/"]',
].join(', ');

function eventTitle(element: HTMLElement): string {
  const value = text(
    element.querySelector(
      '.fc-event-title, .fc-title, .eventTitle, .event-title, .itemTitle, .item-title, a, h1, h2, h3, h4, strong',
    )?.textContent,
  ) || text(element.textContent);
  const withoutTime = value.replace(/^\d{1,2}:\d{2}\s*[ap](?:m)?\s*/i, '').trim();
  return /^\d{1,2}$/.test(withoutTime) ? '' : withoutTime;
}

function firstAttribute(element: HTMLElement, attributes: string[]): string {
  for (const attribute of attributes) {
    const value = text(element.getAttribute(attribute));
    if (value) return value;
  }
  return '';
}

function firstDescendantText(element: HTMLElement, selectors: string): string {
  return text(element.querySelector(selectors)?.textContent);
}

function parseCalendarDate(value: string | null): string {
  const candidate = text(value);
  const iso = candidate.match(/(20\d{2}[-/]\d{1,2}[-/]\d{1,2})/);
  if (iso) {
    const [year, month, day] = iso[1].split(/[-/]/).map(Number);
    if (year && month <= 12 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00`;
    }
  }
  const named = candidate.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,\s*|\s+)(20\d{2})\b/i);
  if (!named) return '';
  const month = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
    .indexOf(named[1].toLowerCase()) + 1;
  const day = Number(named[2]);
  const year = Number(named[3]);
  if (!month || day < 1 || day > 31) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00`;
}

function nearestCalendarDate(element: HTMLElement): string {
  const owner = element.parentElement?.closest<HTMLElement>(
    '[data-date], [data-event-date], [data-day], td[title], td, .dayGridCell, .calendarDay, .day, [role="gridcell"]',
  );
  if (!owner) return '';
  for (const attribute of ['data-date', 'data-event-date', 'data-day', 'title', 'aria-label']) {
    const parsed = parseCalendarDate(owner.getAttribute(attribute));
    if (parsed) return parsed;
  }
  return parseCalendarDate(owner.textContent);
}

function inferItemType(value: string, fallback: string): string {
  const explicit = fallback.toLowerCase();
  if (/assignment|homework|作业/.test(explicit)) return 'assignment';
  if (/project|milestone|项目/.test(explicit)) return 'project';
  if (/exam|midterm|final|test|考试/.test(explicit)) return 'exam';
  const normalized = value.toLowerCase();
  if (/assignment|homework|problem\s*set|作业/.test(normalized)) return 'assignment';
  if (/project|milestone|项目/.test(normalized)) return 'project';
  if (/exam|midterm|final|test|考试/.test(normalized)) return 'exam';
  return fallback || 'other';
}

function safeAbsoluteUrl(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return '';
  }
}

function isAssignmentUrl(url: URL): boolean {
  const path = url.pathname.toLowerCase();
  return path.includes('/webapps/assignment/uploadassignment')
    && Boolean(url.searchParams.get('content_id'))
    && Boolean(url.searchParams.get('course_id'));
}

function decodeEmbeddedHtml(value: string): string {
  if (typeof DOMParser === 'undefined') return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const document = new DOMParser().parseFromString(`<textarea>${value}</textarea>`, 'text/html');
  return document.querySelector('textarea')?.value ?? value;
}

function embeddedAssignmentUrls(html: string, baseUrl: string): Array<{ url: string; score: number }> {
  const decoded = decodeEmbeddedHtml(html).replace(/\\u0026/gi, '&').replace(/\\x26/gi, '&').replace(/\\\//g, '/');
  const values = new Set<string>();
  const pattern = /(?:https?:\/\/bb\.cuhk\.edu\.cn)?\/webapps\/assignment\/uploadAssignment\?[^\s"'<>\\]+/gi;
  for (const source of [html, decoded]) {
    for (const match of source.matchAll(pattern)) values.add(match[0].replace(/[),.;]+$/, ''));
  }
  return [...values].flatMap((value) => {
    try {
      const url = new URL(value, baseUrl);
      if (!isAssignmentUrl(url)) return [];
      const score = decoded.toLowerCase().includes(url.href.toLowerCase()) ? 2 : 1;
      return [{ url: url.href, score }];
    } catch { return []; }
  });
}

/** Finds the real Blackboard assignment target in an event detail response. */
export function findBlackboardAssignmentUrl(html: string, baseUrl: string, title = ''): string | null {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const normalizedTitle = text(title).toLowerCase();
  const anchorCandidates = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
    .map((anchor) => {
      const absolute = safeAbsoluteUrl(anchor.getAttribute('href') ?? '', baseUrl);
      if (!absolute) return null;
      let url: URL;
      try { url = new URL(absolute); } catch { return null; }
      if (url.hostname.toLowerCase() !== 'bb.cuhk.edu.cn' || !isAssignmentUrl(url)) return null;
      const anchorText = text(anchor.textContent).toLowerCase();
      const titleMatch = normalizedTitle && (anchorText === normalizedTitle || anchorText.includes(normalizedTitle));
      return { url: url.href, score: titleMatch ? 2 : 1 };
    })
    .filter((candidate): candidate is { url: string; score: number } => Boolean(candidate))
    .sort((left, right) => right.score - left.score);
  const candidates = [...anchorCandidates, ...embeddedAssignmentUrls(html, baseUrl)];
  return candidates.sort((left, right) => right.score - left.score)[0]?.url ?? null;
}

export function parseBlackboardCalendarHtml(html: string, baseUrl: string): BlackboardItem[] {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const elements = Array.from(document.querySelectorAll<HTMLElement>(calendarEventSelector));
  const candidates: BlackboardItem[] = [];

  for (const element of elements) {
    const dueNode = element.querySelector<HTMLElement>('time[datetime], [data-due], [data-due-date]');
    const dueAt = dueNode?.getAttribute('datetime')
      || dueNode?.getAttribute('data-due')
      || dueNode?.getAttribute('data-due-date')
      || firstAttribute(element, ['data-due', 'data-due-date', 'data-start', 'data-event-date', 'datetime'])
      || parseCalendarDate(element.textContent)
      || nearestCalendarDate(element);
    if (!dueAt) continue;

    const title = eventTitle(element);
    if (!title) continue;

    const href = element.getAttribute('data-assignment-url')
      || (element.matches('a[href]')
        ? (element.getAttribute('href') || '')
        : (element.querySelector<HTMLAnchorElement>('a[href*="/webapps/assignment/uploadAssignment"], a[href*="content_id="][href*="course_id="]')?.getAttribute('href')
          || element.querySelector<HTMLAnchorElement>('a[href]')?.getAttribute('href')
          || ''));
    const courseName = firstAttribute(element, ['data-course-name', 'data-calendar-name', 'data-calendar-title'])
      || firstDescendantText(element, '[data-course-name], [data-calendar-name], .course-name, .course, .calendar-name')
      || 'Blackboard 课程';
    const courseCode = firstAttribute(element, ['data-course-code'])
      || firstDescendantText(element, '[data-course-code], .course-code')
      || null;
    const itemType = inferItemType(title, firstAttribute(element, ['data-item-type'])
      || firstDescendantText(element, '[data-item-type], .item-type')
      || (/fc-event|calendar-event|eventItem/i.test(element.className) ? 'event' : 'other'));
    const externalId = firstAttribute(element, ['data-item-id', 'data-id', 'data-event-id'])
      || element.id
      || null;

    const sourceUrl = href ? new URL(href, baseUrl).href : '';
    candidates.push(normalizeExternalItem({
      externalId,
      courseName,
      courseCode,
      title,
      itemType,
      dueAt,
      sourceUrl,
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
