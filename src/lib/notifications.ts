import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import type { Reminder } from './domain/types';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function notifyReminder(reminder: Reminder): Promise<void> {
  const title = 'MemoFlow 提醒';
  const body = reminder.title;
  if (isTauri()) {
    let granted = await isPermissionGranted();
    if (!granted) granted = (await requestPermission()) === 'granted';
    if (!granted) throw new Error('Notification permission was not granted');
    await sendNotification({ title, body });
    return;
  }
  if (typeof Notification === 'undefined') throw new Error('Notifications are unavailable');
  let permission = Notification.permission;
  if (permission === 'default' && typeof Notification.requestPermission === 'function') permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted');
  new Notification(title, { body });
}
