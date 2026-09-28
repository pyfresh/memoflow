import { describe, expect, it } from 'vitest';
import { getReminderOccurrences } from '../../src/lib/domain/reminders';
import type { Reminder } from '../../src/lib/domain/types';

describe('getReminderOccurrences', () => {
  it('returns one occurrence for a one-time reminder in range', () => {
    const reminder: Reminder = {
      id: 'r1', memoId: null, title: 'Submit project', dueAt: '2026-10-08T23:59:00+08:00',
      recurrenceRule: null, status: 'pending', notificationSentAt: null,
      createdAt: '2026-09-28T10:00:00+08:00', updatedAt: '2026-09-28T10:00:00+08:00',
    };
    expect(getReminderOccurrences(reminder, '2026-10-01', '2026-10-31')).toEqual([
      '2026-10-08T23:59:00+08:00',
    ]);
  });

  it('expands a weekly recurrence without emitting dates outside the range', () => {
    const reminder: Reminder = {
      id: 'r2', memoId: null, title: 'Weekly review', dueAt: '2026-10-05T09:00:00+08:00',
      recurrenceRule: 'FREQ=WEEKLY', status: 'pending', notificationSentAt: null,
      createdAt: '2026-09-28T10:00:00+08:00', updatedAt: '2026-09-28T10:00:00+08:00',
    };
    expect(getReminderOccurrences(reminder, '2026-10-01', '2026-10-31')).toEqual([
      '2026-10-05T09:00:00+08:00',
      '2026-10-12T09:00:00+08:00',
      '2026-10-19T09:00:00+08:00',
      '2026-10-26T09:00:00+08:00',
    ]);
  });

  it('clamps monthly occurrences without drifting from the anchor day', () => {
    const reminder: Reminder = {
      id: 'r3', memoId: null, title: 'Rent', dueAt: '2026-01-31T09:00:00+08:00',
      recurrenceRule: 'FREQ=MONTHLY', recurrenceAnchorAt: '2026-01-31T09:00:00+08:00',
      status: 'pending', notificationSentAt: null, createdAt: '2026-01-01T00:00:00+08:00', updatedAt: '2026-01-01T00:00:00+08:00',
    };
    expect(getReminderOccurrences(reminder, '2026-01-01', '2026-04-30').map((value) => value.slice(0, 10))).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30',
    ]);
  });

  it('rejects impossible local dates instead of rolling them into the next month', () => {
    const reminder: Reminder = {
      id: 'invalid', memoId: null, title: 'Bad date', dueAt: '2026-02-30T09:00:00+08:00',
      recurrenceRule: null, status: 'pending', notificationSentAt: null,
      createdAt: '', updatedAt: '',
    };
    expect(() => getReminderOccurrences(reminder, '2026-02-01', '2026-02-28')).toThrow(/Invalid reminder date/);
  });
});
