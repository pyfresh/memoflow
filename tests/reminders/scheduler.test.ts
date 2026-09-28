import { describe, expect, it } from 'vitest';
import { getDueReminders, runReminderSchedulerTick } from '../../src/lib/reminders/scheduler';
import type { Reminder } from '../../src/lib/domain/types';

const reminder = (overrides: Partial<Reminder>): Reminder => ({
  id: 'r',
  memoId: 'm',
  title: '提醒',
  dueAt: '2026-10-01T09:00:00+08:00',
  recurrenceRule: null,
  status: 'pending',
  notificationSentAt: null,
  createdAt: '2026-09-28T10:00:00+08:00',
  updatedAt: '2026-09-28T10:00:00+08:00',
  ...overrides,
});

describe('getDueReminders', () => {
  it('returns only pending reminders due at or before now that were not notified', () => {
    const now = new Date('2026-10-01T10:00:00+08:00');
    expect(getDueReminders([
      reminder({ id: 'due' }),
      reminder({ id: 'future', dueAt: '2026-10-01T11:00:00+08:00' }),
      reminder({ id: 'done', status: 'completed' }),
      reminder({ id: 'ignored', status: 'ignored' }),
      reminder({ id: 'sent', notificationSentAt: '2026-10-01T09:30:00+08:00' }),
    ], now).map((item) => item.id)).toEqual(['due']);
  });
});


describe('runReminderSchedulerTick', () => {
  it('acknowledges only successful delivery so a failure is retried', async () => {
    let attempts = 0;
    const marked: string[] = [];
    const repository = {
      listReminders: () => [reminder({ id: 'retry' })],
      markNotificationSent: (id: string) => { marked.push(id); },
    };
    await expect(runReminderSchedulerTick(repository, async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary delivery failure');
    }, new Date('2026-10-01T10:00:00+08:00'))).rejects.toThrow('temporary delivery failure');
    expect(marked).toEqual([]);
    await runReminderSchedulerTick(repository, async () => { attempts += 1; }, new Date('2026-10-01T10:00:00+08:00'));
    expect(marked).toEqual(['retry']);
    expect(attempts).toBe(2);
  });

  it('delivers due reminders serially', async () => {
    let active = 0;
    let peak = 0;
    const repository = {
      listReminders: () => [reminder({ id: 'one' }), reminder({ id: 'two' })],
      markNotificationSent: () => {},
    };
    await runReminderSchedulerTick(repository, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
    }, new Date('2026-10-01T10:00:00+08:00'));
    expect(peak).toBe(1);
  });
});

