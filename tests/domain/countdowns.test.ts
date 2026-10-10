import { describe, expect, it } from 'vitest';
import { advanceCountdown, countdownProgress, createCountdownDraft } from '../../src/lib/domain/countdowns';

describe('countdown domain', () => {
  it('creates a named countdown with the requested duration', () => {
    const countdown = createCountdownDraft({ name: '专注写作', hours: 1, minutes: 2, seconds: 3 }, '2026-10-06T09:00:00.000Z');

    expect(countdown).toMatchObject({
      name: '专注写作',
      totalSeconds: 3723,
      remainingSeconds: 3723,
      status: 'idle',
      notificationSentAt: null,
    });
    expect(countdown.createdAt).toBe('2026-10-06T09:00:00.000Z');
  });

  it('decreases a running countdown and completes exactly at zero', () => {
    const countdown = createCountdownDraft({ name: '阅读', hours: 0, minutes: 0, seconds: 5 }, '2026-10-06T09:00:00.000Z');
    const running = { ...countdown, status: 'running' as const };

    expect(advanceCountdown(running, 2)).toMatchObject({ remainingSeconds: 3, status: 'running' });
    expect(advanceCountdown(running, 5)).toMatchObject({ remainingSeconds: 0, status: 'completed' });
    expect(advanceCountdown(running, 8)).toMatchObject({ remainingSeconds: 0, status: 'completed' });
  });

  it('reports a circular progress ratio for the remaining duration', () => {
    const countdown = createCountdownDraft({ name: '复习', hours: 0, minutes: 10, seconds: 0 }, '2026-10-06T09:00:00.000Z');
    expect(countdownProgress(countdown)).toBe(1);
    expect(countdownProgress({ ...countdown, remainingSeconds: 300 })).toBe(0.5);
    expect(countdownProgress({ ...countdown, remainingSeconds: 0 })).toBe(0);
  });
});
