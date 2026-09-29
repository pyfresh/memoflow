import { describe, expect, it } from 'vitest';
import { getWeekdayLabel, parseScheduleTime, startOfWeek } from '../../src/lib/domain/schedule';

describe('weekly schedule domain helpers', () => {
  it('labels Monday-first weekdays and rejects invalid values', () => {
    expect(getWeekdayLabel(1)).toBe('周一');
    expect(getWeekdayLabel(7)).toBe('周日');
    expect(() => getWeekdayLabel(0)).toThrow('Invalid weekday');
  });

  it('normalizes schedule times to HH:mm', () => {
    expect(parseScheduleTime('9:05')).toBe('09:05');
    expect(parseScheduleTime('09:05:00')).toBe('09:05');
    expect(parseScheduleTime('9pm')).toBeNull();
  });

  it('finds the Monday at the start of a week', () => {
    const monday = startOfWeek(new Date('2026-09-29T12:00:00+08:00'));
    expect([monday.getFullYear(), monday.getMonth() + 1, monday.getDate()]).toEqual([2026, 9, 28]);
  });
});
