import { describe, expect, it, vi } from 'vitest';
import { notifyCountdown } from '../../src/lib/notifications';
import type { Countdown } from '../../src/lib/domain/types';

const countdown: Countdown = {
  id: 'countdown-1', name: '专注写作', totalSeconds: 1500, remainingSeconds: 0, status: 'completed',
  notificationSentAt: null, delivery: { nativeSentAt: null, pushplusSentAt: null, pushplusLastError: null },
  createdAt: '2026-10-07T09:00:00.000Z', updatedAt: '2026-10-07T09:25:00.000Z',
};

describe('countdown notifications', () => {
  it('sends a completed countdown to WeChat through PushPlus', async () => {
    const transport = vi.fn().mockResolvedValue({ code: 200, msg: '请求成功' });

    const result = await notifyCountdown(countdown, { pushplusEnabled: true, pushplusToken: 'test-token' }, transport);

    expect(result.pushplus).toEqual({ sent: true });
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      title: '专注写作', channel: 'wechat', template: 'txt',
      content: '倒计时已结束\n总时长：25 分钟',
    }));
  });

  it.each([
    [5, '5 秒'],
    [90, '1 分钟 30 秒'],
    [3600, '1 小时'],
    [3661, '1 小时 1 分钟 1 秒'],
    [90061, '25 小时 1 分钟 1 秒'],
  ])('includes the original total duration of %i seconds', async (totalSeconds, duration) => {
    const transport = vi.fn().mockResolvedValue({ code: 200, msg: '请求成功' });
    await notifyCountdown({ ...countdown, totalSeconds }, { pushplusEnabled: true, pushplusToken: 'test-token' }, transport);
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      title: countdown.name, content: `倒计时已结束\n总时长：${duration}`,
    }));
  });

  it('does not resend an already delivered countdown', async () => {
    const transport = vi.fn();
    await notifyCountdown({ ...countdown, delivery: {
      nativeSentAt: null, pushplusSentAt: '2026-10-07T09:25:00.000Z', pushplusLastError: null,
    } }, { pushplusEnabled: true, pushplusToken: 'test-token' }, transport);
    expect(transport).not.toHaveBeenCalled();
  });

  it('returns a retryable PushPlus failure instead of marking delivery as sent', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('network down'));

    const result = await notifyCountdown(countdown, { pushplusEnabled: true, pushplusToken: 'test-token' }, transport);

    expect(result.pushplus?.sent).toBe(false);
    expect(result.pushplus?.error).toContain('network down');
  });
});
