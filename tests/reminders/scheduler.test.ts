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

  it('uses an assignment notification time before its deadline', () => {
    const assignment = reminder({
      id: 'assignment',
      dueAt: '2026-10-08T23:59:00+08:00',
      notificationAt: '2026-10-07T23:59:00+08:00',
    });
    const ordinary = reminder({ id: 'ordinary', dueAt: '2026-10-08T23:59:00+08:00' });

    expect(getDueReminders([assignment, ordinary], new Date('2026-10-07T23:58:00+08:00')).map((item) => item.id)).toEqual([]);
    expect(getDueReminders([assignment, ordinary], new Date('2026-10-07T23:59:00+08:00')).map((item) => item.id)).toEqual(['assignment']);
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

  it('records channels independently so a failed PushPlus delivery is retried alone', async () => {
    const stored = reminder({ id: 'channels' });
    const sent: Array<[string, string]> = [];
    const failed: Array<[string, string, string]> = [];
    let pushplusAttempts = 0;
    const repository = {
      listReminders: () => [stored],
      markNotificationChannelSent: (id: string, channel: string) => {
        sent.push([id, channel]);
        stored.delivery = { nativeSentAt: stored.delivery?.nativeSentAt ?? null, pushplusSentAt: stored.delivery?.pushplusSentAt ?? null, pushplusLastError: null };
        if (channel === 'native') stored.delivery.nativeSentAt = '2026-10-01T10:01:00.000Z';
        if (channel === 'pushplus') stored.delivery.pushplusSentAt = '2026-10-01T10:02:00.000Z';
      },
      markNotificationChannelFailed: (id: string, channel: string, error: string) => { failed.push([id, channel, error]); },
    };
    await expect(runReminderSchedulerTick(repository, async () => {
      pushplusAttempts += 1;
      return pushplusAttempts === 1
        ? { native: { sent: true }, pushplus: { sent: false, error: '网络暂时不可用' } }
        : { pushplus: { sent: true } };
    }, new Date('2026-10-01T10:00:00+08:00'))).rejects.toThrow('网络暂时不可用');
    expect(sent).toEqual([['channels', 'native']]);
    expect(failed).toEqual([['channels', 'pushplus', '网络暂时不可用']]);

    await runReminderSchedulerTick(repository, async () => ({ pushplus: { sent: true } }), new Date('2026-10-01T10:00:00+08:00'));
    expect(sent).toEqual([['channels', 'native'], ['channels', 'pushplus']]);
  });

  it('flushes channel state and completes when no external channel remains', async () => {
    const marked: string[] = [];
    let flushes = 0;
    const repository = {
      listReminders: () => [reminder({ id: 'native-only', delivery: { nativeSentAt: '2026-10-01T09:01:00.000Z', pushplusSentAt: null, pushplusLastError: null } })],
      markNotificationSent: (id: string) => { marked.push(id); },
      flush: async () => { flushes += 1; },
    };
    await runReminderSchedulerTick(repository, async () => ({}), new Date('2026-10-01T10:00:00+08:00'));
    expect(marked).toEqual(['native-only']);
    expect(flushes).toBe(1);
  });

  it('keeps a queued DSH message pending until a later tick reports sent', async () => {
    const stored = reminder({ id: 'dsh-queued' });
    const sent: string[] = [];
    const queued: string[] = [];
    const repository = {
      listReminders: () => [stored],
      markNotificationChannelQueued: (_id: string, _channel: string, file: string) => {
        queued.push(file);
        stored.delivery = {
          nativeSentAt: stored.delivery?.nativeSentAt ?? null,
          pushplusSentAt: stored.delivery?.pushplusSentAt ?? null,
          pushplusLastError: stored.delivery?.pushplusLastError ?? null,
          ...stored.delivery,
          dshQueuedFile: file,
        };
      },
      markNotificationChannelSent: (_id: string, channel: string) => {
        sent.push(channel);
        stored.delivery = {
          nativeSentAt: stored.delivery?.nativeSentAt ?? null,
          pushplusSentAt: stored.delivery?.pushplusSentAt ?? null,
          pushplusLastError: stored.delivery?.pushplusLastError ?? null,
          ...stored.delivery,
          dshQueuedFile: null,
          dshSentAt: '2026-10-01T10:01:00.000Z',
        };
      },
      markNotificationChannelFailed: () => {},
    };

    await runReminderSchedulerTick(repository, async () => ({ dsh: { sent: false, pending: true, queuedFile: 'outbox/1.json' } }), new Date('2026-10-01T10:00:00+08:00'));
    expect(queued).toEqual(['outbox/1.json']);
    expect(sent).toEqual([]);
    expect(stored.notificationSentAt).toBeNull();

    await runReminderSchedulerTick(repository, async () => ({ dsh: { sent: true } }), new Date('2026-10-01T10:00:30+08:00'));
    expect(sent).toEqual(['dsh']);
  });
});

