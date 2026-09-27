import type { CalendarCell } from './types';

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function buildMonthGrid(year: number, month: number, today = isoDate(new Date())): CalendarCell[] {
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
