import type { Reminder } from './types';

function parseLocalIso(value: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) throw new Error(`Invalid reminder date: ${value}`);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
  };
}

function formatLocalIso(parts: ReturnType<typeof parseLocalIso>): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}+08:00`;
}

function shiftLocalDays(value: string, days: number): string {
  const parts = parseLocalIso(value);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, parts.hour, parts.minute, parts.second));
  return formatLocalIso({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  });
}

function shiftLocalMonths(value: string, months: number): string {
  const parts = parseLocalIso(value);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1 + months, parts.day, parts.hour, parts.minute, parts.second));
  return formatLocalIso({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  });
}

export function getReminderOccurrences(reminder: Reminder, rangeStart: string, rangeEnd: string): string[] {
  const dueDate = reminder.dueAt.slice(0, 10);
  const occurrences: string[] = [];
  if (!reminder.recurrenceRule) {
    if (dueDate >= rangeStart && dueDate <= rangeEnd) occurrences.push(reminder.dueAt);
    return occurrences;
  }

  const frequency = reminder.recurrenceRule.match(/FREQ=(DAILY|WEEKLY|MONTHLY)/)?.[1] ?? 'DAILY';
  let current = reminder.dueAt;
  for (let index = 0; index < 1000 && current.slice(0, 10) <= rangeEnd; index += 1) {
    if (current.slice(0, 10) >= rangeStart) occurrences.push(current);
    current = frequency === 'DAILY'
      ? shiftLocalDays(current, 1)
      : frequency === 'WEEKLY'
        ? shiftLocalDays(current, 7)
        : shiftLocalMonths(current, 1);
  }
  return occurrences;
}
