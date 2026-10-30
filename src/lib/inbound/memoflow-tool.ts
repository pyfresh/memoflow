import { normalizeLocalDateTime } from '../data/repository';

export type InboundReminderInput = {
  title: string;
  body?: string;
  dueAt?: string;
  date?: string;
  time?: string;
  timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'night';
  recurrenceRule?: string | null;
  externalId?: string | null;
  source?: 'dsh' | 'manual';
};

export type InboundReminderValidation =
  | { status: 'ready'; input: Required<Pick<InboundReminderInput, 'title' | 'body' | 'dueAt'>> & Pick<InboundReminderInput, 'recurrenceRule' | 'externalId' | 'source'> }
  | { status: 'needs_confirmation'; message: string; title: string; date?: string; timeOfDay?: string };

const allowedKeys = new Set(['title', 'body', 'dueAt', 'date', 'time', 'timeOfDay', 'recurrenceRule', 'externalId', 'source']);

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, field: string, maxLength: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.trim().length > maxLength) throw new Error(`${field} 格式无效`);
  return value.trim();
}

export function validateInboundReminderInput(value: unknown): InboundReminderValidation {
  if (!isPlainRecord(value)) throw new Error('请求必须是 JSON 对象');
  const unknownKey = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknownKey) throw new Error(`不支持的字段：${unknownKey}`);

  const title = text(value.title, 'title', 200);
  if (!title) throw new Error('事项名称不能为空');
  const body = text(value.body, 'body', 10_000);
  const recurrenceRule = value.recurrenceRule === null || value.recurrenceRule === undefined ? null : text(value.recurrenceRule, 'recurrenceRule', 200);
  const externalId = value.externalId === null || value.externalId === undefined ? null : text(value.externalId, 'externalId', 200);
  const source = value.source === 'manual' ? 'manual' : 'dsh';
  const timeOfDay = value.timeOfDay === undefined ? undefined : text(value.timeOfDay, 'timeOfDay', 30);
  if (timeOfDay && !['morning', 'afternoon', 'evening', 'night'].includes(timeOfDay)) throw new Error('timeOfDay 格式无效');

  let dueAt = text(value.dueAt, 'dueAt', 80);
  if (!dueAt) {
    const date = text(value.date, 'date', 10);
    const time = text(value.time, 'time', 5);
    if (date && time) dueAt = `${date}T${time}`;
    else {
      if (!date) throw new Error('缺少日期，请先补充具体日期和时间');
      return { status: 'needs_confirmation', message: '日期已识别，但缺少具体时间，请补充几点几分。', title, date, ...(timeOfDay ? { timeOfDay } : {}) };
    }
  }

  return {
    status: 'ready',
    input: {
      title,
      body,
      dueAt: normalizeLocalDateTime(dueAt),
      recurrenceRule,
      externalId,
      source,
    },
  };
}

