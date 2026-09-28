import { describe, expect, it } from 'vitest';
import { LocalRepository, type StorageLike } from '../../src/lib/data/repository';

class MemoryStorage implements StorageLike {
  private value: string | null = null;
  getItem() { return this.value; }
  setItem(_key: string, value: string) { this.value = value; }
  removeItem() { this.value = null; }
}

describe('import recovery', () => {
  it('does not create a memo when a Blackboard item has no deadline', () => {
    const repository = new LocalRepository(new MemoryStorage());
    const result = repository.importBlackboardItems([{
      externalId: 'missing-date',
      courseName: 'CSC 201',
      courseCode: 'CSC201',
      title: 'Announcement',
      itemType: 'event',
      dueAt: null,
      sourceUrl: 'https://bb.cuhk.edu.cn/announcement',
    }]);

    expect(result.errorCount).toBe(1);
    expect(repository.load().memos).toHaveLength(0);
    expect(repository.load().reminders).toHaveLength(0);
  });
});
