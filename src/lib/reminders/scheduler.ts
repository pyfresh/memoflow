import type { Reminder } from '../domain/types';

export function getDueReminders(reminders: Reminder[], now = new Date()): Reminder[] {
  const timestamp = now.getTime();
  return reminders.filter((reminder) => {
    if (reminder.status !== 'pending' || reminder.notificationSentAt) return false;
    const due = new Date(reminder.dueAt).getTime();
    return !Number.isNaN(due) && due <= timestamp;
  });
}

export interface SchedulerRepository {
  listReminders(): Reminder[] | Promise<Reminder[]>;
  markNotificationSent(id: string, sentAt: string): void | Promise<void>;
}

export async function runReminderSchedulerTick(
  repository: SchedulerRepository,
  notify: (reminder: Reminder) => void | Promise<void>,
  now = new Date(),
): Promise<void> {
  const reminders = await repository.listReminders();
  let firstError: unknown;
  for (const reminder of getDueReminders(reminders, now)) {
    // Await delivery. A rejection leaves notificationSentAt empty so the next
    // tick retries the reminder.
    try {
      await notify(reminder);
      await repository.markNotificationSent(reminder.id, new Date().toISOString());
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError) throw firstError;
}

export function startReminderScheduler(
  repository: SchedulerRepository,
  notify: (reminder: Reminder) => void | Promise<void>,
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


