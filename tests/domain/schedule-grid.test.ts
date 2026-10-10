import { describe, expect, it } from 'vitest';
import { getScheduleGridPosition, parseScheduleMinutes } from '../../src/lib/domain/schedule-grid';

describe('schedule grid positioning', () => {
  it('converts valid clock strings to minutes from the grid start', () => {
    expect(parseScheduleMinutes('08:30')).toBe(510);
    expect(parseScheduleMinutes('14:00')).toBe(840);
    expect(parseScheduleMinutes('19:30')).toBe(1170);
  });

  it('returns top offset and height for a course block', () => {
    const position = getScheduleGridPosition('14:00', '16:50', '08:30', 40);
    expect(position.top).toBe(220);
    expect(position.height).toBeCloseTo(113.33333333333333, 8);
  });

  it('clamps a course that starts before or ends after the visible grid', () => {
    expect(getScheduleGridPosition('07:30', '23:00', '08:30', 40)).toEqual({ top: 0, height: 540 });
  });
});
