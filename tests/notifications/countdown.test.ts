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
      title: 'MemoFlow 提醒', channel: 'wechat', template: 'txt',
      content: expect.stringContaining('倒计时完成：专注写作'),
    }));
  });

  it('returns a retryable PushPlus failure instead of marking delivery as sent', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('network down'));

    const result = await notifyCountdown(countdown, { pushplusEnabled: true, pushplusToken: 'test-token' }, transport);

    expect(result.pushplus?.sent).toBe(false);
    expect(result.pushplus?.error).toContain('network down');
  });
});
