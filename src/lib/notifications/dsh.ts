import { invoke } from '@tauri-apps/api/core';
import type { Countdown, Reminder } from '../domain/types';
import { formatCountdownDuration } from './pushplus';

export interface DshMessage {
  text: string;
  peerId?: string;
}

export interface DshQueueResult {
  ok: true;
  file: string;
}

export interface DshDeliveryStatus {
  status: 'pending' | 'sent' | 'failed';
  error?: string;
}

export interface DshNotificationTransport {
  enqueue(message: DshMessage): Promise<DshQueueResult>;
  check(file: string): Promise<DshDeliveryStatus>;
}

export const DEFAULT_DSH_HOST = '127.0.0.1';
export const DEFAULT_DSH_PORT = 7239;

export function validateDshHost(host: string): string {
  const value = host.trim().toLowerCase();
  if (value !== '127.0.0.1' && value !== 'localhost') throw new Error('DSH 仅允许使用回环地址');
  return value;
}

function formatDueAt(value: string): string {
  return value.replace('T', ' ').replace(/([+-]\d{2}:?\d{2}|Z)$/, '').slice(0, 16);
}

export function buildDshReminderText(reminder: Reminder, courseCode?: string, itemType?: string): string {
  const tags = [itemType, courseCode].filter(Boolean).join(' · ');
  return [`${reminder.title}`, `截止时间：${formatDueAt(reminder.dueAt)}`, tags ? `类型：${tags}` : ''].filter(Boolean).join('\n');
}

export function buildDshCountdownText(countdown: Countdown): string {
  return [countdown.name, '倒计时已结束', `总时长：${formatCountdownDuration(countdown.totalSeconds)}`].join('\n');
}

function parseQueueResponse(value: unknown): DshQueueResult {
  if (!value || typeof value !== 'object' || (value as { ok?: unknown }).ok !== true || typeof (value as { file?: unknown }).file !== 'string' || !(value as { file: string }).file.trim()) {
    throw new Error('DSH 响应缺少队列文件');
  }
  return { ok: true, file: (value as { file: string }).file };
}

function parseDeliveryStatus(value: unknown): DshDeliveryStatus {
  if (!value || typeof value !== 'object') throw new Error('DSH 回执格式无效');
  const status = (value as { status?: unknown }).status;
  if (status !== 'pending' && status !== 'sent' && status !== 'failed') throw new Error('DSH 回执状态无效');
  const error = typeof (value as { error?: unknown }).error === 'string' ? (value as { error: string }).error : undefined;
  return { status, ...(error ? { error } : {}) };
}

export function createBrowserDshTransport(options: {
  fetchImpl?: typeof fetch;
  host?: string;
  port?: number;
  statusImpl?: (file: string) => Promise<DshDeliveryStatus>;
} = {}): DshNotificationTransport {
  const host = validateDshHost(options.host ?? DEFAULT_DSH_HOST);
  const port = options.port ?? DEFAULT_DSH_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('DSH 端口无效');
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async enqueue(message) {
      const response = await fetchImpl(`http://${host}:${port}/wxbridge/push`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message.text, ...(message.peerId?.trim() ? { to: message.peerId.trim() } : {}) }),
      });
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new Error(`DSH HTTP ${response.status}`); }
      if (!response.ok) throw new Error(`DSH HTTP ${response.status}`);
      return parseQueueResponse(payload);
    },
    async check(file) {
      if (options.statusImpl) return parseDeliveryStatus(await options.statusImpl(file));
      return { status: 'pending' };
    },
  };
}

type DshInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export function createTauriDshTransport(invokeImpl: DshInvoke = invoke, settings: { host?: string; port?: number } = {}): DshNotificationTransport {
  const host = validateDshHost(settings.host ?? DEFAULT_DSH_HOST);
  const port = settings.port ?? DEFAULT_DSH_PORT;
  return {
    enqueue: (message) => invokeImpl<DshQueueResult>('send_dsh_wxbridge_message', { message: { text: message.text, host, port, peerId: message.peerId ?? '' } }).then(parseQueueResponse),
    check: (file) => invokeImpl<DshDeliveryStatus>('check_dsh_wxbridge_delivery', { file }).then(parseDeliveryStatus),
  };
}

export function defaultDshTransport(settings: { host?: string; port?: number } = {}): DshNotificationTransport {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  return isTauri ? createTauriDshTransport(invoke, settings) : createBrowserDshTransport(settings);
}

export async function enqueueDshMessage(message: DshMessage, settings: { host?: string; port?: number } = {}, transport?: DshNotificationTransport): Promise<DshQueueResult> {
  if (!message.text.trim()) throw new Error('DSH 消息不能为空');
  return (transport ?? defaultDshTransport(settings)).enqueue(message);
}
