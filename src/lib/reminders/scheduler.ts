import type { Reminder } from '../domain/types';

export function getDueReminders(reminders: Reminder[], now = new Date()): Reminder[] {
  const timestamp = now.getTime();
  return reminders.filter((reminder) => {
    if (reminder.status !== 'pending' || reminder.notificationSentAt) return false;
    const due = new Date(reminder.notificationAt ?? reminder.dueAt).getTime();
    return !Number.isNaN(due) && due <= timestamp;
  });
}

export interface SchedulerRepository {
  listReminders(): Reminder[] | Promise<Reminder[]>;
  markNotificationSent?: (id: string, sentAt: string) => void | Promise<void>;
  markNotificationChannelSent?: (id: string, channel: 'native' | 'pushplus', sentAt: string) => void | Promise<void>;
  markNotificationChannelFailed?: (id: string, channel: 'native' | 'pushplus', error: string) => void | Promise<void>;
  flush?: () => void | Promise<void>;
}

export interface NotificationDeliveryResult {
  native?: { sent: boolean; error?: string };
  pushplus?: { sent: boolean; error?: string };
}

type NotifyResult = void | NotificationDeliveryResult;

export async function runReminderSchedulerTick(
  repository: SchedulerRepository,
  notify: (reminder: Reminder) => NotifyResult | Promise<NotifyResult>,
  now = new Date(),
): Promise<void> {
  const reminders = await repository.listReminders();
  let firstError: unknown;
  for (const reminder of getDueReminders(reminders, now)) {
    // Await delivery. A rejection leaves notificationSentAt empty so the next
    // tick retries the reminder.
    try {
      const result = await notify(reminder);
      const sentAt = new Date().toISOString();
      const hasOutcome = Boolean(result && (result.native || result.pushplus));
      if (!hasOutcome || !repository.markNotificationChannelSent) {
        if (!repository.markNotificationSent) throw new Error('提醒存储不支持通知状态更新');
        await repository.markNotificationSent(reminder.id, sentAt);
        await repository.flush?.();
        continue;
      }
      const delivery = result as NotificationDeliveryResult;
      let deliveryError: Error | undefined;
      for (const channel of ['native', 'pushplus'] as const) {
        const outcome = delivery[channel];
        if (!outcome) continue;
        if (outcome.sent) await repository.markNotificationChannelSent(reminder.id, channel, sentAt);
        else if (outcome.error) {
          if (repository.markNotificationChannelFailed) await repository.markNotificationChannelFailed(reminder.id, channel, outcome.error);
          deliveryError ??= new Error(outcome.error);
        }
      }
      await repository.flush?.();
      if (deliveryError) throw deliveryError;
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError) throw firstError;
}

export function startReminderScheduler(
  repository: SchedulerRepository,
  notify: (reminder: Reminder) => NotifyResult | Promise<NotifyResult>,
  intervalMs = 30_000,
): () => void {
  let running = false;
  let stopped = false;
  const check = async () => {
    if (running || stopped) return;
    running = true;
    try { await runReminderSchedulerTick(repository, notify); } finally { running = false; }
  };
  void check().catch(() => undefined);
  const timer = setInterval(() => { void check().catch(() => undefined); }, intervalMs);
  return () => { stopped = true; clearInterval(timer); };
}


