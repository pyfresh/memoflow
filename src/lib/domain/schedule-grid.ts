export function parseScheduleMinutes(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export interface ScheduleGridPosition {
  top: number;
  height: number;
}

export function getScheduleGridPosition(
  startTime: string,
  endTime: string,
  gridStart: string,
  pixelsPerHour: number,
): ScheduleGridPosition {
  const visibleStart = parseScheduleMinutes(gridStart) ?? 0;
  const start = parseScheduleMinutes(startTime) ?? visibleStart;
  const end = parseScheduleMinutes(endTime) ?? start;
  const visibleEnd = visibleStart + 13.5 * 60;
  const clampedStart = Math.max(visibleStart, Math.min(start, visibleEnd));
  const clampedEnd = Math.max(clampedStart, Math.min(end, visibleEnd));
  return {
    top: ((clampedStart - visibleStart) / 60) * pixelsPerHour,
    height: ((clampedEnd - clampedStart) / 60) * pixelsPerHour,
  };
}
