import { invoke } from '@tauri-apps/api/core';
import type { Reminder } from '../domain/types';

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

export function buildPushPlusMessage(reminder: Reminder, courseCode?: string, itemType?: string, token = 'token'): PushPlusMessage {
  const due = reminder.dueAt.replace('T', ' ').replace(/([+-]\d{2}:?\d{2}|Z)$/, '').slice(0, 16);
  const tags = [itemType, courseCode].filter(Boolean).join(' · ');
  const content = [`${reminder.title}`, `截止时间：${due}`, tags ? `标签：${tags}` : ''].filter(Boolean).join('\n');
  return { token, title: 'MemoFlow 提醒', content, channel: 'wechat', template: 'txt' };
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
