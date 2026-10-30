import { describe, expect, it } from 'vitest';
import { validateInboundReminderInput } from '../../src/lib/inbound/memoflow-tool';

describe('MemoFlow inbound tool input', () => {
  it('normalizes an exact date and time without hardcoding a date', () => {
    const result = validateInboundReminderInput({ title: '考试', date: '2026-10-26', time: '15:00', body: '下周一下午有一门考试' });
    expect(result).toEqual({ status: 'ready', input: expect.objectContaining({ title: '考试', dueAt: '2026-10-26T15:00:00+08:00', body: '下周一下午有一门考试' }) });
  });

  it('asks for an exact time when only an afternoon period is available', () => {
    const result = validateInboundReminderInput({ title: '考试', date: '2026-10-26', timeOfDay: 'afternoon' });
    expect(result).toEqual({ status: 'needs_confirmation', title: '考试', date: '2026-10-26', timeOfDay: 'afternoon', message: expect.stringContaining('具体时间') });
  });

  it('rejects unsupported fields instead of accepting arbitrary writes', () => {
    expect(() => validateInboundReminderInput({ title: '考试', date: '2026-10-26', time: '15:00', path: 'C:\\secret' })).toThrow('不支持的字段');
  });

  it('rejects invalid dates and times', () => {
    expect(() => validateInboundReminderInput({ title: '考试', date: '2026-99-99', time: '15:00' })).toThrow();
    expect(() => validateInboundReminderInput({ title: '考试', date: '2026-10-26', time: '25:00' })).toThrow();
  });
});

