import type { CalendarCell } from './types';

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function todayInHongKong(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function buildMonthGrid(year: number, month: number, today = todayInHongKong()): CalendarCell[] {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Invalid calendar month: ${year}-${month}`);
  }
  const first = new Date(Date.UTC(year, month - 1, 1));
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cellCount = Math.ceil((mondayOffset + daysInMonth) / 7) * 7;
  const start = new Date(Date.UTC(year, month - 1, 1 - mondayOffset));

  return Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return {
      date: isoDate(date),
      isCurrentMonth: date.getUTCMonth() === month - 1,
      isToday: isoDate(date) === today,
    };
  });
}
