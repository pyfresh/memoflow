import type { Countdown } from './types';

export interface CountdownDraft {
  name: string;
  hours: number;
  minutes: number;
  seconds: number;
}

export function countdownTotalSeconds(hours: number, minutes: number, seconds: number): number {
  const values = [hours, minutes, seconds];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error('倒计时时间必须是非负数字');
  const total = Math.floor(hours * 3600 + minutes * 60 + seconds);
  if (total <= 0) throw new Error('倒计时至少需要 1 秒');
  return total;
}

export function createCountdownDraft(draft: CountdownDraft, timestamp = new Date().toISOString()): Countdown {
  const name = draft.name.trim();
  if (!name) throw new Error('倒计时名称不能为空');
  const totalSeconds = countdownTotalSeconds(draft.hours, draft.minutes, draft.seconds);
  return {
    id: '',
    name,
    totalSeconds,
    remainingSeconds: totalSeconds,
    status: 'idle',
    notificationSentAt: null,
    delivery: { nativeSentAt: null, pushplusSentAt: null, pushplusLastError: null },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function advanceCountdown(countdown: Countdown, elapsedSeconds: number, timestamp = countdown.updatedAt): Countdown {
  if (countdown.status !== 'running' || elapsedSeconds <= 0) return countdown;
  const remainingSeconds = Math.max(0, countdown.remainingSeconds - Math.floor(elapsedSeconds));
  return {
    ...countdown,
    remainingSeconds,
    status: remainingSeconds === 0 ? 'completed' : 'running',
    updatedAt: timestamp,
  };
}

export function countdownProgress(countdown: Pick<Countdown, 'totalSeconds' | 'remainingSeconds'>): number {
  if (countdown.totalSeconds <= 0) return 0;
  return Math.max(0, Math.min(1, countdown.remainingSeconds / countdown.totalSeconds));
}
