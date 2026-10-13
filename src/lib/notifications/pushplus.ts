import { invoke } from '@tauri-apps/api/core';
import type { Countdown, Reminder } from '../domain/types';

export interface PushPlusMessage {
  token: string;
  title: string;
  content: string;
  channel: 'wechat';
  template: 'txt';
}

export interface PushPlusResponse {
  code: number;
  msg: string;
  data?: unknown;
}

export type PushPlusTransport = (message: PushPlusMessage) => Promise<PushPlusResponse>;

export function redactToken(token: string): string {
  const value = token.trim();
  if (value.length <= 6) return '••••••';
  return `${value.slice(0, 3)}••••${value.slice(-3)}`;
}

export function formatCountdownDuration(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours} 小时`);
  if (minutes) parts.push(`${minutes} 分钟`);
  if (seconds || parts.length === 0) parts.push(`${seconds} 秒`);
  return parts.join(' ');
}

export function buildPushPlusMessage(reminder: Reminder, courseCode?: string, itemType?: string, token = 'token'): PushPlusMessage {
  const due = reminder.dueAt.replace('T', ' ').replace(/([+-]\d{2}:?\d{2}|Z)$/, '').slice(0, 16);
  const tags = [itemType, courseCode].filter(Boolean).join(' · ');
  const content = [`截止时间：${due}`, tags ? `标签：${tags}` : ''].filter(Boolean).join('\n');
  return { token, title: reminder.title, content, channel: 'wechat', template: 'txt' };
}

export function buildPushPlusCountdownMessage(countdown: Countdown, token = 'token'): PushPlusMessage {
  return {
    token,
    title: countdown.name,
    content: `倒计时已结束\n总时长：${formatCountdownDuration(countdown.totalSeconds)}`,
    channel: 'wechat',
    template: 'txt',
  };
}

export function validatePushPlusResponse(value: unknown): PushPlusResponse {
  if (!value || typeof value !== 'object' || typeof (value as PushPlusResponse).code !== 'number' || typeof (value as PushPlusResponse).msg !== 'string') {
    throw new Error('PushPlus 响应格式无效');
  }
  const response = value as PushPlusResponse;
  if (response.code !== 200) throw new Error(`PushPlus：${response.msg}`);
  return response;
}

const invokePushPlus: PushPlusTransport = async (message) => invoke<PushPlusResponse>('send_pushplus_message', { message });

export async function sendPushPlusMessage(token: string, message: Omit<PushPlusMessage, 'token'>, transport: PushPlusTransport = invokePushPlus): Promise<PushPlusResponse> {
  const trimmed = token.trim();
  if (!trimmed) throw new Error('PushPlus Token 不能为空');
  try {
    return validatePushPlusResponse(await transport({ ...message, token: trimmed }));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('PushPlus：')) throw error;
    throw new Error(`PushPlus 请求失败（Token ${redactToken(trimmed)}）：${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function sendPushPlusReminder(reminder: Reminder, token: string, courseCode?: string, itemType?: string, transport: PushPlusTransport = invokePushPlus): Promise<PushPlusResponse> {
  const message = buildPushPlusMessage(reminder, courseCode, itemType, '');
  const { token: _ignored, ...body } = message;
  return sendPushPlusMessage(token, body, transport);
}

export async function sendPushPlusCountdown(countdown: Countdown, token: string, transport: PushPlusTransport = invokePushPlus): Promise<PushPlusResponse> {
  const message = buildPushPlusCountdownMessage(countdown, '');
  const { token: _ignored, ...body } = message;
  return sendPushPlusMessage(token, body, transport);
}
