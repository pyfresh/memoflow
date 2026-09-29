import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import WeeklySchedule from '../../src/components/WeeklySchedule.svelte';

describe('WeeklySchedule', () => {
  it('renders a Monday-first week and imported course cards', () => {
    render(WeeklySchedule, {
      weekStart: new Date(2026, 8, 28),
      entries: [{
        id: 'schedule-1', courseName: 'MATH 101', courseCode: 'MATH101', weekday: 2,
        startTime: '09:00', endTime: '10:30', location: 'YIA LT6', source: 'blackboard',
        externalId: 'class-1', sourceUrl: 'https://bb/course/1', createdAt: '2026-09-01T00:00:00+08:00', updatedAt: '2026-09-01T00:00:00+08:00',
      }],
    });

    expect(screen.getByRole('region', { name: '周课表' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /2026 年 9 月 28 日/ })).toBeInTheDocument();
    expect(screen.getAllByRole('region')).toHaveLength(8);
    expect(screen.getByText('MATH 101')).toBeInTheDocument();
    expect(screen.getByText('09:00 - 10:30')).toBeInTheDocument();
  });

  it('shows an empty state when Blackboard has no course schedule rows', () => {
    render(WeeklySchedule, { weekStart: new Date(2026, 8, 28), entries: [] });
    expect(screen.getByText('同步 Blackboard 后，这里会显示你的每周课程。')).toBeInTheDocument();
  });
});
