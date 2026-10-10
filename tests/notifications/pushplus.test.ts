import { describe, expect, it, vi } from 'vitest';
import { buildPushPlusMessage, redactToken, sendPushPlusMessage, validatePushPlusResponse } from '../../src/lib/notifications/pushplus';

describe('PushPlus adapter', () => {
  it('builds a text message without rich HTML', () => {
    const message = buildPushPlusMessage({
      id: 'r1', memoId: 'm1', title: 'Assignment 1', dueAt: '2026-10-08T23:59:00+08:00',
      recurrenceRule: null, status: 'pending', notificationSentAt: null,
      createdAt: '2026-10-01T00:00:00+08:00', updatedAt: '2026-10-01T00:00:00+08:00',
    }, 'AIS6002', 'assignment');

    expect(message).toMatchObject({ token: 'token', title: 'MemoFlow 提醒', channel: 'wechat', template: 'txt' });
    expect(message.content).toContain('Assignment 1');
    expect(message.content).toContain('AIS6002');
    expect(message.content).not.toContain('<p>');
  });

  it('accepts the provider success response and rejects business errors', () => {
    expect(validatePushPlusResponse({ code: 200, msg: '请求成功' })).toEqual({ code: 200, msg: '请求成功' });
    expect(() => validatePushPlusResponse({ code: 999, msg: 'token无效' })).toThrow('token无效');
    expect(() => validatePushPlusResponse({ nope: true })).toThrow('响应格式');
  });

  it('redacts tokens and rejects blank tokens before transport', async () => {
    expect(redactToken('abcdefghijk')).toBe('abc••••ijk');
    const transport = vi.fn();
    await expect(sendPushPlusMessage('  ', { title: 'test', content: 'test', channel: 'wechat', template: 'txt' }, transport)).rejects.toThrow('Token');
    expect(transport).not.toHaveBeenCalled();
  });
});
