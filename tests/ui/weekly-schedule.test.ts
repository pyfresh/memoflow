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
    expect(screen.getAllByRole('region')).toHaveLength(6);
    expect(screen.getByText('时间')).toBeInTheDocument();
    expect(screen.getByText('周一')).toBeInTheDocument();
    expect(screen.getByText('MATH 101')).toBeInTheDocument();
    expect(screen.getByText('09:00 - 10:30')).toBeInTheDocument();
    expect(screen.getByText('MATH 101').closest('article')).toHaveStyle('top: 20px; height: 60px');
  });

  it('offers ZIP import and explains the empty state', () => {
    render(WeeklySchedule, { weekStart: new Date(2026, 8, 28), entries: [] });
    expect(screen.getByRole('button', { name: '导入课表 ZIP' })).toBeInTheDocument();
    expect(screen.getByText('导入课表 ZIP 后，这里会显示你的每周课程。')).toBeInTheDocument();
  });

  it('hides a course outside its imported term range', () => {
    render(WeeklySchedule, {
      weekStart: new Date(2026, 8, 28),
      entries: [{
        id: 'schedule-future', courseName: 'Future Course', courseCode: 'FUTURE101', weekday: 2,
        startTime: '09:00', endTime: '10:00', location: 'Room 1', source: 'archive', externalId: 'future-1',
        sourceUrl: 'archive://future.ics', startDate: '2026-10-05', endDate: '2026-12-14', recurrenceRule: 'FREQ=WEEKLY',
        createdAt: '2026-09-01T00:00:00+08:00', updatedAt: '2026-09-01T00:00:00+08:00',
      }],
    });
    expect(screen.queryByText('Future Course')).not.toBeInTheDocument();
  });
});
