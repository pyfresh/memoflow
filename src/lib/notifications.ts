import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import type { Countdown, NotificationSettings, Reminder } from './domain/types';
import { sendPushPlusCountdown, sendPushPlusReminder, type PushPlusTransport } from './notifications/pushplus';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export interface ReminderNotificationResult {
  native?: { sent: boolean; error?: string };
  pushplus?: { sent: boolean; error?: string };
}

function countdownReminder(countdown: Countdown): Reminder {
  const now = new Date().toISOString();
  return {
    id: `countdown-reminder-${countdown.id}`,
    memoId: null,
    title: `倒计时完成：${countdown.name}`,
    dueAt: now,
    recurrenceRule: null,
    status: 'pending',
    notificationSentAt: countdown.notificationSentAt,
    delivery: countdown.delivery,
    createdAt: countdown.createdAt,
    updatedAt: countdown.updatedAt,
  };
}

export async function notifyReminder(
  reminder: Reminder,
  settings: NotificationSettings = { pushplusEnabled: false, pushplusToken: '' },
  context: { courseCode?: string; itemType?: string } = {},
  pushplusTransport?: PushPlusTransport,
): Promise<ReminderNotificationResult> {
  const result: ReminderNotificationResult = {};
  const title = 'MemoFlow 提醒';
  const body = reminder.title;
  if (!reminder.delivery?.nativeSentAt) {
    try {
      if (isTauri()) {
        let granted = await isPermissionGranted();
        if (!granted) granted = (await requestPermission()) === 'granted';
        if (!granted) throw new Error('Notification permission was not granted');
        await sendNotification({ title, body });
      } else {
        if (typeof Notification === 'undefined') throw new Error('Notifications are unavailable');
        let permission = Notification.permission;
        if (permission === 'default' && typeof Notification.requestPermission === 'function') permission = await Notification.requestPermission();
        if (permission !== 'granted') throw new Error('Notification permission was not granted');
        new Notification(title, { body });
      }
      result.native = { sent: true };
    } catch (error) {
      result.native = { sent: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  if (settings.pushplusEnabled && settings.pushplusToken.trim() && !reminder.delivery?.pushplusSentAt) {
    try {
      await sendPushPlusReminder(reminder, settings.pushplusToken, context.courseCode, context.itemType, pushplusTransport);
      result.pushplus = { sent: true };
    } catch (error) {
      result.pushplus = { sent: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return result;
}

export function notifyCountdown(
  countdown: Countdown,
  settings: NotificationSettings = { pushplusEnabled: false, pushplusToken: '' },
  pushplusTransport?: PushPlusTransport,
): Promise<ReminderNotificationResult> {
  const reminder = countdownReminder(countdown);
  return notifyReminder(reminder, { ...settings, pushplusEnabled: false }, {}, pushplusTransport).then(async (result) => {
    if (!settings.pushplusEnabled || !settings.pushplusToken.trim() || countdown.delivery?.pushplusSentAt) return result;
    try {
      await sendPushPlusCountdown(countdown, settings.pushplusToken, pushplusTransport);
      return { ...result, pushplus: { sent: true } };
    } catch (error) {
      return { ...result, pushplus: { sent: false, error: error instanceof Error ? error.message : String(error) } };
    }
  });
}
