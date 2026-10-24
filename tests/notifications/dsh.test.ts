import { describe, expect, it, vi } from 'vitest';
import { buildDshCountdownText, buildDshReminderText, createBrowserDshTransport, validateDshHost } from '../../src/lib/notifications/dsh';
import { notifyReminder } from '../../src/lib/notifications';

describe('DSH wxbridge adapter', () => {
  it('formats reminder and countdown text as plain text', () => {
    expect(buildDshReminderText({
      id: 'r1', memoId: null, title: 'Assignment 1', dueAt: '2026-10-08T23:59:00+08:00',
      recurrenceRule: null, status: 'pending', notificationSentAt: null,
      createdAt: '2026-10-01T00:00:00+08:00', updatedAt: '2026-10-01T00:00:00+08:00',
    }, 'AIS6002', 'assignment')).toBe('Assignment 1\n截止时间：2026-10-08 23:59\n类型：assignment · AIS6002');
    expect(buildDshCountdownText({
      id: 'c1', name: '专注写作', totalSeconds: 1500, remainingSeconds: 0, status: 'completed', notificationSentAt: null,
      createdAt: '2026-10-01T00:00:00+08:00', updatedAt: '2026-10-01T00:00:00+08:00',
    })).toBe('专注写作\n倒计时已结束\n总时长：25 分钟');
  });

  it('allows only loopback hosts', () => {
    expect(validateDshHost('127.0.0.1')).toBe('127.0.0.1');
    expect(validateDshHost('localhost')).toBe('localhost');
    expect(() => validateDshHost('192.168.1.20')).toThrow('回环地址');
  });

  it('queues a message through the local host route and preserves the returned file', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, file: 'C:\\Users\\test\\.dsh\\wxbridge\\outbox\\1.json' }),
    });
    const transport = createBrowserDshTransport({ fetchImpl: fetchMock, host: '127.0.0.1', port: 7239 });

    await expect(transport.enqueue({ text: '测试消息', peerId: 'peer-1' })).resolves.toEqual({
      ok: true,
      file: 'C:\\Users\\test\\.dsh\\wxbridge\\outbox\\1.json',
    });
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:7239/wxbridge/push', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ text: '测试消息', to: 'peer-1' }),
    }));
  });

  it('rejects a bridge response without an outbox file', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const transport = createBrowserDshTransport({ fetchImpl: fetchMock, host: '127.0.0.1', port: 7239 });
    await expect(transport.enqueue({ text: '测试消息' })).rejects.toThrow('队列文件');
  });

  it('queues a reminder and keeps it pending until the bridge reports sent', async () => {
    const transport = {
      enqueue: vi.fn().mockResolvedValue({ ok: true as const, file: 'C:\\Users\\test\\.dsh\\wxbridge\\outbox\\2.json' }),
      check: vi.fn().mockResolvedValue({ status: 'pending' as const }),
    };
    const reminder = {
      id: 'r1', memoId: null, title: 'Assignment 1', dueAt: '2026-10-08T23:59:00+08:00',
      recurrenceRule: null, status: 'pending' as const, notificationSentAt: null,
      createdAt: '2026-10-01T00:00:00+08:00', updatedAt: '2026-10-01T00:00:00+08:00',
    };
    const first = await notifyReminder(reminder, { pushplusEnabled: false, pushplusToken: '', dshEnabled: true, dshPort: 7239, dshPeerId: 'peer-1' }, { courseCode: 'AIS6002', itemType: 'assignment' }, undefined, transport);
    expect(first.dsh).toEqual({ sent: false, pending: true, queuedFile: 'C:\\Users\\test\\.dsh\\wxbridge\\outbox\\2.json' });
    expect(transport.enqueue).toHaveBeenCalledWith({ text: 'Assignment 1\n截止时间：2026-10-08 23:59\n类型：assignment · AIS6002', peerId: 'peer-1' });

    transport.check.mockResolvedValue({ status: 'sent' });
    const second = await notifyReminder({ ...reminder, delivery: { nativeSentAt: null, pushplusSentAt: null, pushplusLastError: null, dshQueuedFile: 'C:\\Users\\test\\.dsh\\wxbridge\\outbox\\2.json' } }, { pushplusEnabled: false, pushplusToken: '', dshEnabled: true, dshPort: 7239, dshPeerId: 'peer-1' }, {}, undefined, transport);
    expect(second.dsh).toEqual({ sent: true });
    expect(transport.check).toHaveBeenCalledWith('C:\\Users\\test\\.dsh\\wxbridge\\outbox\\2.json');
  });
});
