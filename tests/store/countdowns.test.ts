import { beforeEach, describe, expect, it } from 'vitest';
import { createBrowserRepository } from '../../src/lib/data/repository';

describe('countdown repository', () => {
  beforeEach(() => localStorage.clear());

  it('persists a named countdown and supports running, pausing, resetting and deleting it', () => {
    const repository = createBrowserRepository();
    const countdown = repository.createCountdown({ name: '写报告', totalSeconds: 90 });

    expect(repository.load().countdowns).toHaveLength(1);
    expect(repository.load().countdowns?.[0]).toMatchObject({ name: '写报告', totalSeconds: 90, remainingSeconds: 90, status: 'idle' });

    repository.updateCountdown(countdown.id, { status: 'running' });
    expect(repository.load().countdowns?.[0].status).toBe('running');
    repository.advanceCountdowns(30);
    expect(repository.load().countdowns?.[0].remainingSeconds).toBe(60);
    repository.updateCountdown(countdown.id, { status: 'paused' });
    repository.resetCountdown(countdown.id);
    expect(repository.load().countdowns?.[0]).toMatchObject({ remainingSeconds: 90, status: 'idle', notificationSentAt: null });

    repository.deleteCountdown(countdown.id);
    expect(repository.load().countdowns).toEqual([]);
  });

  it('migrates snapshots created before countdowns existed', () => {
    localStorage.setItem('memoflow.snapshot.v1', JSON.stringify({ memos: [], reminders: [], blackboardItems: [] }));
    expect(createBrowserRepository().load().countdowns).toEqual([]);
  });

  it('marks a completed countdown notification once delivery succeeds', () => {
    const repository = createBrowserRepository();
    const countdown = repository.createCountdown({ name: '短暂休息', totalSeconds: 2 });
    repository.updateCountdown(countdown.id, { status: 'running' });
    repository.advanceCountdowns(2);

    expect(repository.load().countdowns?.[0]).toMatchObject({ status: 'completed', remainingSeconds: 0, notificationSentAt: null });
    repository.markCountdownNotificationChannelSent(countdown.id, 'native', '2026-10-06T09:00:02.000Z');
    expect(repository.load().countdowns?.[0].notificationSentAt).toBe('2026-10-06T09:00:02.000Z');
  });

  it('considers a successful PushPlus delivery sent even when native notification is unavailable', () => {
    const repository = createBrowserRepository();
    repository.saveNotificationSettings({ pushplusEnabled: true, pushplusToken: 'test-token' });
    const countdown = repository.createCountdown({ name: '微信提醒', totalSeconds: 1 });

    repository.markCountdownNotificationChannelSent(countdown.id, 'pushplus', '2026-10-07T09:00:01.000Z');

    expect(repository.load().countdowns?.[0].notificationSentAt).toBe('2026-10-07T09:00:01.000Z');
  });
});
