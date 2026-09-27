import { describe, expect, it } from 'vitest';
import { buildMonthGrid } from '../../src/lib/domain/calendar';

describe('buildMonthGrid', () => {
  it('starts weeks on Monday and includes the full October 2026 month', () => {
    const grid = buildMonthGrid(2026, 10);

    expect(grid.length).toBe(35);
    expect(grid[0].date).toBe('2026-09-28');
    expect(grid.find((cell) => cell.date === '2026-10-01')?.isCurrentMonth).toBe(true);
    expect(grid.at(-1)?.date).toBe('2026-11-01');
  });

  it('marks the current day without changing the calendar date', () => {
    const grid = buildMonthGrid(2026, 10, '2026-10-08');

    expect(grid.find((cell) => cell.date === '2026-10-08')?.isToday).toBe(true);
    expect(grid.find((cell) => cell.date === '2026-10-07')?.isToday).toBe(false);
  });
});
