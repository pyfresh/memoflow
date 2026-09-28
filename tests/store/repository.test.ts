import { beforeEach, describe, expect, it } from 'vitest';
import { LocalRepository, type StorageLike } from '../../src/lib/data/repository';

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe('LocalRepository', () => {
  let storage: MemoryStorage;
  let repository: LocalRepository;

  beforeEach(() => {
    storage = new MemoryStorage();
    repository = new LocalRepository(storage);
  });

  it('persists a rich-text memo and its reminder', () => {
    const memo = repository.saveMemoDraft({
      title: '买咖啡豆',
      body: '<p>周末采购</p>',
      reminderAt: '2026-10-05T09:00',
      recurrenceRule: 'FREQ=WEEKLY',
    });

    const snapshot = repository.load();
    expect(snapshot.memos[0]).toMatchObject({ id: memo.id, title: '买咖啡豆', richText: '<p>周末采购</p>' });
    expect(snapshot.reminders[0]).toMatchObject({
      memoId: memo.id,
      title: '买咖啡豆',
      dueAt: '2026-10-05T09:00:00+08:00',
      recurrenceRule: 'FREQ=WEEKLY',
      status: 'pending',
    });
  });

  it('updates reminder status without changing memo content', () => {
    const memo = repository.saveMemoDraft({ title: '缴费', body: '<p>水电费</p>', reminderAt: '2026-10-06T09:00', recurrenceRule: null });
    repository.setReminderStatus(memo.reminderId!, 'completed');

    expect(repository.load().memos[0].richText).toBe('<p>水电费</p>');
    expect(repository.load().reminders[0].status).toBe('completed');
  });

  it('imports a Blackboard item once and updates its deadline on the next sync', () => {
    const first = repository.importBlackboardItems([{
      externalId: 'bb-1',
      courseName: 'MATH 101',
      courseCode: 'MATH101',
      title: 'Project 1',
      itemType: 'project',
      dueAt: '2026-10-08T23:59:00+08:00',
      sourceUrl: 'https://bb.cuhk.edu.cn/item/1',
    }]);
    const second = repository.importBlackboardItems([{
      externalId: 'bb-1',
      courseName: 'MATH 101',
      courseCode: 'MATH101',
      title: 'Project 1',
      itemType: 'project',
      dueAt: '2026-10-09T23:59:00+08:00',
      sourceUrl: 'https://bb.cuhk.edu.cn/item/1',
    }]);

    expect(first.newCount).toBe(1);
    expect(second.newCount).toBe(0);
    expect(second.updatedCount).toBe(1);
    expect(repository.load().memos).toHaveLength(1);
    expect(repository.load().reminders[0].dueAt).toBe('2026-10-09T23:59:00+08:00');
  });
  it('supports categories, tags and standalone reminders', () => {
    const memo = repository.saveMemoDraft({ title: '标签', body: '<p>x</p>', reminderAt: '', recurrenceRule: null, categoryId: 'work', tags: ['a', 'b'] });
    const reminder = repository.saveReminderDraft({ title: '独立提醒', dueAt: '2026-10-10T09:00', recurrenceRule: null });
    expect(memo.categoryId).toBe('work');
    expect(memo.tags).toEqual(['a', 'b']);
    expect(reminder.memoId).toBeNull();
    expect(repository.load().reminders).toHaveLength(1);
  });

  it('advances a repeated reminder after completing the current occurrence', () => {
    const reminder = repository.saveReminderDraft({ title: '每月缴费', dueAt: '2026-01-31T09:00', recurrenceRule: 'FREQ=MONTHLY' });
    repository.setReminderStatus(reminder.id, 'completed');
    const next = repository.load().reminders[0];
    expect(next.status).toBe('pending');
    expect(next.dueAt).toBe('2026-02-28T09:00:00+08:00');
    expect(next.recurrenceAnchorAt).toBe('2026-01-31T09:00:00+08:00');
    expect(next.occurrenceHistory).toEqual([{ at: '2026-01-31T09:00:00+08:00', status: 'completed' }]);
  });

  it('throws on corrupt storage instead of silently resetting', () => {
    storage.setItem('memoflow.snapshot.v1', '{broken');
    expect(() => repository.load()).toThrow('Unable to parse snapshot');
  });

  it('preserves local memo edits while synchronizing remote fields', () => {
    repository.importBlackboardItems([{
      externalId: 'bb-local', courseName: 'MATH 101', courseCode: 'MATH101', title: 'Project 1',
      itemType: 'project', dueAt: '2026-10-08T23:59:00+08:00', sourceUrl: 'https://bb/item/local',
    }]);
    const memo = repository.load().memos[0];
    repository.updateMemo(memo.id, { title: '我的标题', richText: '<p>我的内容</p>', tags: ['mine'], categoryId: 'life' });
    repository.importBlackboardItems([{
      externalId: 'bb-local', courseName: 'MATH 101', courseCode: 'MATH101', title: 'Project 1 updated',
      itemType: 'project', dueAt: '2026-10-09T23:59:00+08:00', sourceUrl: 'https://bb/item/local',
    }]);
    const updated = repository.load().memos[0];
    expect(updated).toMatchObject({ title: '我的标题', richText: '<p>我的内容</p>', tags: ['mine'], categoryId: 'life' });
    expect(repository.load().reminders[0].dueAt).toBe('2026-10-09T23:59:00+08:00');
  });

  it('seeds a complete demo dataset once without duplicating user data', () => {
    const first = repository.seedDemoData(new Date('2026-09-29T12:00:00+08:00'));
    const firstSnapshot = repository.load();

    expect(first).toEqual({ addedMemos: 4, addedReminders: 6, addedBlackboardItems: 1 });
    expect(firstSnapshot.memos).toHaveLength(4);
    expect(firstSnapshot.reminders).toHaveLength(6);
    expect(firstSnapshot.blackboardItems).toHaveLength(1);
    expect(firstSnapshot.reminders.every((item) => item.dueAt.startsWith('2026-09-'))).toBe(true);

    const second = repository.seedDemoData(new Date('2026-09-29T12:00:00+08:00'));
    expect(second).toEqual({ addedMemos: 0, addedReminders: 0, addedBlackboardItems: 0 });
    expect(repository.load().memos).toHaveLength(4);
    expect(repository.load().reminders).toHaveLength(6);
  });
});
