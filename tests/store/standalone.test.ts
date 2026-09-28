import { describe, expect, it } from 'vitest';
import { LocalRepository, type StorageLike } from '../../src/lib/data/repository';

class MemoryStorage implements StorageLike {
  private value: string | null = null;
  getItem() { return this.value; }
  setItem(_key: string, value: string) { this.value = value; }
  removeItem() { this.value = null; }
}

describe('standalone reminders', () => {
  it('creates a reminder without creating a memo', () => {
    const repository = new LocalRepository(new MemoryStorage());
    const reminder = repository.saveReminderDraft({
      title: '只提醒我打电话',
      dueAt: '2026-10-05T09:00',
      recurrenceRule: null,
      memoId: null,
    });
    const snapshot = repository.load();
    expect(reminder.memoId).toBeNull();
    expect(snapshot.memos).toHaveLength(0);
    expect(snapshot.reminders).toHaveLength(1);
    expect(snapshot.reminders[0].title).toBe('只提醒我打电话');
  });
});
