const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export function getWeekdayLabel(weekday: number): string {
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw new Error(`Invalid weekday: ${weekday}`);
  return WEEKDAY_LABELS[weekday - 1];
}

export function parseScheduleTime(value: string | null | undefined): string | null {
  const match = value?.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

export function startOfWeek(date: Date): Date {
  const result = new Date(date);
  const day = result.getDay() || 7;
  result.setDate(result.getDate() - day + 1);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function formatScheduleDate(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date);
}
