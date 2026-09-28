import type { Reminder } from './types';

export interface LocalDateTimeParts {
  year: number; month: number; day: number; hour: number; minute: number; second: number;
}

export function parseLocalIso(value: string): LocalDateTimeParts {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:Z|[+-]\d{2}:?\d{2})?$/);
  if (!match) throw new Error(`Invalid reminder date: ${value}`);
  const parts = {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6] ?? 0),
  };
  const daysInMonth = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > daysInMonth
    || parts.hour > 23 || parts.minute > 59 || parts.second > 59
    || check.getUTCFullYear() !== parts.year || check.getUTCMonth() !== parts.month - 1 || check.getUTCDate() !== parts.day) {
    throw new Error(`Invalid reminder date: ${value}`);
  }
  return parts;
}

export function formatLocalIso(parts: LocalDateTimeParts): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}+08:00`;
}

function shiftLocalDays(value: string, days: number): string {
  const parts = parseLocalIso(value);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, parts.hour, parts.minute, parts.second));
  return formatLocalIso({
    year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes(), second: shifted.getUTCSeconds(),
  });
}

function shiftLocalMonths(value: string, months: number): string {
  const parts = parseLocalIso(value);
  const targetMonth = new Date(Date.UTC(parts.year, parts.month - 1 + months, 1));
  const daysInTarget = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(parts.day, daysInTarget);
  const shifted = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth(), day, parts.hour, parts.minute, parts.second));
  return formatLocalIso({
    year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes(), second: shifted.getUTCSeconds(),
  });
}

function recurrenceFrequency(rule: string): 'DAILY' | 'WEEKLY' | 'MONTHLY' {
  const match = rule.match(/(?:^|;)FREQ=(DAILY|WEEKLY|MONTHLY)(?:;|$)/i);
  if (!match) throw new Error(`Unsupported recurrence rule: ${rule}`);
  return match[1].toUpperCase() as 'DAILY' | 'WEEKLY' | 'MONTHLY';
}

export function getReminderOccurrences(reminder: Reminder, rangeStart: string, rangeEnd: string): string[] {
  parseDateOnly(rangeStart);
  parseDateOnly(rangeEnd);
  if (rangeStart > rangeEnd) throw new Error(`Invalid occurrence range: ${rangeStart}..${rangeEnd}`);
  const dueDate = parseLocalIso(reminder.dueAt) && reminder.dueAt.slice(0, 10);
  const occurrences: string[] = [];
  if (!reminder.recurrenceRule) {
    if (dueDate >= rangeStart && dueDate <= rangeEnd) occurrences.push(reminder.dueAt);
    return occurrences;
  }

  const frequency = recurrenceFrequency(reminder.recurrenceRule);
  const anchor = reminder.recurrenceAnchorAt ?? reminder.dueAt;
  parseLocalIso(anchor);
  let current = anchor;
  let index = 0;
  while (current.slice(0, 10) <= rangeEnd) {
    if (current.slice(0, 10) >= rangeStart) occurrences.push(current);
    index += 1;
    current = frequency === 'DAILY' ? shiftLocalDays(anchor, index)
      : frequency === 'WEEKLY' ? shiftLocalDays(anchor, index * 7)
        : shiftLocalMonths(anchor, index);
  }
  return occurrences;
}

function parseDateOnly(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid date: ${value}`);
  const check = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== value) throw new Error(`Invalid date: ${value}`);
}

export function advanceReminderOccurrence(reminder: Reminder): string {
  if (!reminder.recurrenceRule) throw new Error('Cannot advance a non-repeating reminder');
  const frequency = recurrenceFrequency(reminder.recurrenceRule);
  const anchor = reminder.recurrenceAnchorAt ?? reminder.dueAt;
  const current = parseLocalIso(reminder.dueAt);
  const anchorParts = parseLocalIso(anchor);
  if (frequency === 'DAILY') return shiftLocalDays(reminder.dueAt, 1);
  if (frequency === 'WEEKLY') return shiftLocalDays(reminder.dueAt, 7);
  const monthsBetween = (current.year - anchorParts.year) * 12 + current.month - anchorParts.month;
  return shiftLocalMonths(anchor, Math.max(1, monthsBetween + 1));
}
