import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import MonthCalendar from '../../src/components/MonthCalendar.svelte';

describe('MonthCalendar', () => {
  it('shows a full month with navigation controls and dated cells', () => {
    render(MonthCalendar, { month: new Date(2026, 9, 1), items: [] });

    expect(screen.getByRole('heading', { name: '2026 年 10 月' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上个月' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下个月' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '今天' })).toBeInTheDocument();
    expect(screen.getByTestId('calendar-cell-2026-10-08')).toBeInTheDocument();
  });

  it('keeps a new pending reminder visually distinct from completed green', () => {
    render(MonthCalendar, {
      month: new Date(2026, 9, 1),
      items: [{ id: 'new-reminder', date: '2026-10-08', title: '新事项', kind: 'reminder', status: 'pending' }],
    });

    const item = screen.getByRole('button', { name: '新事项' });
    expect(item).toHaveClass('reminder');
    expect(item).toHaveClass('pending');
    expect(item).not.toHaveClass('completed');
  });
});
