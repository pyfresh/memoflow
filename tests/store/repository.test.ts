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

  it('persists PushPlus settings and migrates channel delivery state', () => {
    expect(repository.getNotificationSettings()).toEqual({ pushplusEnabled: false, pushplusToken: '' });
    repository.saveNotificationSettings({ pushplusEnabled: true, pushplusToken: 'token-123' });
    expect(repository.getNotificationSettings()).toEqual({ pushplusEnabled: true, pushplusToken: 'token-123' });

    const reminder = repository.saveReminderDraft({ title: '双渠道提醒', dueAt: '2026-10-01T09:00', recurrenceRule: null });
    repository.markNotificationChannelSent(reminder.id, 'native', '2026-10-01T09:01:00.000Z');
    expect(repository.load().reminders[0]).toMatchObject({
      notificationSentAt: null,
      delivery: { nativeSentAt: '2026-10-01T09:01:00.000Z', pushplusSentAt: null },
    });

    repository.markNotificationChannelSent(reminder.id, 'pushplus', '2026-10-01T09:02:00.000Z');
    expect(repository.load().reminders[0].notificationSentAt).toBe('2026-10-01T09:02:00.000Z');
  });

  it('records a PushPlus failure without clearing a successful native delivery', () => {
    const reminder = repository.saveReminderDraft({ title: '失败可重试', dueAt: '2026-10-01T09:00', recurrenceRule: null });
    repository.markNotificationChannelSent(reminder.id, 'native', '2026-10-01T09:01:00.000Z');
    repository.markNotificationChannelFailed(reminder.id, 'pushplus', 'PushPlus 暂时不可用');
    expect(repository.load().reminders[0]).toMatchObject({
      notificationSentAt: null,
      delivery: { nativeSentAt: '2026-10-01T09:01:00.000Z', pushplusSentAt: null, pushplusLastError: 'PushPlus 暂时不可用' },
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

  it('sets early notification times for Blackboard assignments and projects', () => {
    repository.importBlackboardItems([
      {
        externalId: 'bb-assignment-early', courseName: 'AIS6002', courseCode: 'AIS6002', title: 'Assignment 1', itemType: 'assignment',
        dueAt: '2026-10-08T23:59:00+08:00', sourceUrl: 'https://bb/item/assignment-early',
      },
      {
        externalId: 'bb-project-early', courseName: 'CIE6007', courseCode: 'CIE6007', title: 'Project 1', itemType: 'project',
        dueAt: '2026-10-08T23:59:00+08:00', sourceUrl: 'https://bb/item/project-early',
      },
      {
        externalId: 'bb-event-on-time', courseName: 'MATH101', courseCode: 'MATH101', title: 'Lecture', itemType: 'event',
        dueAt: '2026-10-08T23:59:00+08:00', sourceUrl: 'https://bb/item/event-on-time',
      },
    ]);

    const reminders = repository.load().reminders;
    expect(reminders.find((item) => item.title === 'Assignment 1')).toMatchObject({
      dueAt: '2026-10-08T23:59:00+08:00', notificationAt: '2026-10-07T23:59:00+08:00',
    });
    expect(reminders.find((item) => item.title === 'Project 1')).toMatchObject({
      dueAt: '2026-10-08T23:59:00+08:00', notificationAt: '2026-10-07T23:59:00+08:00',
    });
    expect(reminders.find((item) => item.title === 'Lecture')).not.toHaveProperty('notificationAt');
  });

  it('recomputes the early notification when a recurring Blackboard assignment advances', () => {
    repository.importBlackboardItems([{
      externalId: 'bb-recurring-assignment', courseName: 'AIS6002', courseCode: 'AIS6002', title: 'Weekly assignment', itemType: 'assignment',
      dueAt: '2026-10-08T23:59:00+08:00', recurrenceRule: 'FREQ=WEEKLY', sourceUrl: 'https://bb/item/recurring-assignment',
    }]);

    const reminder = repository.load().reminders[0];
    repository.setReminderStatus(reminder.id, 'completed');

    expect(repository.load().reminders[0]).toMatchObject({
      dueAt: '2026-10-15T23:59:00+08:00',
      notificationAt: '2026-10-14T23:59:00+08:00',
      status: 'pending',
    });
  });

  it('stores the Blackboard course code as a deduplicated tag', () => {
    repository.importBlackboardItems([{
      externalId: 'bb-course-tag', courseName: 'AIS6002:Science Foundation for Generative Model_01', courseCode: null,
      title: 'Homework 1', itemType: 'assignment', dueAt: '2026-10-08T23:59:00+08:00', sourceUrl: 'https://bb/item/course-tag',
    }]);
    const snapshot = repository.load();
    snapshot.memos[0].tags.push('重点');
    repository.replaceSnapshot(snapshot);

    repository.importBlackboardItems([{
      externalId: 'bb-course-tag', courseName: 'AIS6002:Science Foundation for Generative Model_01', courseCode: 'AIS6002',
      title: 'Homework 1 updated', itemType: 'assignment', dueAt: '2026-10-09T23:59:00+08:00', sourceUrl: 'https://bb/item/course-tag',
    }]);

    const tags = repository.load().memos[0].tags;
    expect(tags).toContain('重点');
    expect(tags.filter((tag) => tag === 'assignment')).toHaveLength(1);
    expect(tags.filter((tag) => tag === 'AIS6002')).toHaveLength(1);
    expect(tags).not.toContain('AIS6002:Science Foundation for Generative Model_01');
  });

  it('migrates an existing event from a portal URL to its resolved assignment URL', () => {
    repository.importBlackboardItems([{
      externalId: null, courseName: 'CIE6007', courseCode: null, title: 'Assignment 1 - Xili', itemType: 'assignment',
      dueAt: '2026-10-08T23:59:00+08:00', sourceUrl: 'https://bb.cuhk.edu.cn/webapps/portal/execute/tabs/tabAction?tab_tab_group_id=_1_1',
    }]);
    const result = repository.importBlackboardItems([{
      externalId: null, courseName: 'CIE6007', courseCode: null, title: 'Assignment 1 - Xili', itemType: 'assignment',
      dueAt: '2026-10-08T23:59:00+08:00', sourceUrl: 'https://bb.cuhk.edu.cn/webapps/assignment/uploadAssignment?content_id=_671598_1&course_id=_18493_1&group_id=&mode=view',
    }]);

    expect(result).toMatchObject({ newCount: 0, updatedCount: 1 });
    expect(repository.load().memos).toHaveLength(1);
    expect(repository.load().memos[0].sourceUrl).toContain('/webapps/assignment/uploadAssignment');
  });

  it('persists and updates a Blackboard recurrence rule by UID', () => {
    repository.importBlackboardItems([{
      externalId: 'bb-weekly', courseName: 'MATH 101', courseCode: 'MATH101', title: 'Weekly seminar', itemType: 'event',
      dueAt: '2026-10-08T10:30:00+08:00', recurrenceRule: 'FREQ=WEEKLY', sourceUrl: 'https://bb.cuhk.edu.cn/item/weekly',
    }]);
    repository.importBlackboardItems([{
      externalId: 'bb-weekly', courseName: 'MATH 101', courseCode: 'MATH101', title: 'Weekly seminar', itemType: 'event',
      dueAt: '2026-10-09T10:30:00+08:00', recurrenceRule: 'FREQ=MONTHLY', sourceUrl: 'https://bb.cuhk.edu.cn/item/weekly',
    }]);

    const snapshot = repository.load();
    expect(snapshot.reminders).toHaveLength(1);
    expect(snapshot.reminders[0]).toMatchObject({ dueAt: '2026-10-09T10:30:00+08:00', recurrenceRule: 'FREQ=MONTHLY' });
  });

  it('persists iCalendar descriptions as the imported memo body', () => {
    repository.importBlackboardItems([{
      externalId: 'bb-description', courseName: 'CSC 201', courseCode: 'CSC201', title: 'Reading', itemType: 'event',
      dueAt: '2026-10-08T10:30:00+08:00', sourceUrl: 'https://bb.cuhk.edu.cn/calendar/event/description', localMemoContent: 'Read chapter 1\nBring questions',
    }]);
    expect(repository.load().memos[0].richText).toContain('Read chapter 1');
    expect(repository.load().memos[0].richText).toContain('Bring questions');
  });

  it('removes the legacy date-cell placeholder created by the old Blackboard importer', () => {
    repository.replaceSnapshot({
      memos: [{ id: 'legacy-memo', title: '30', richText: '<p>未命名课程</p>', categoryId: 'course', tags: ['other'], source: 'blackboard', externalItemId: null, sourceUrl: 'https://bb.cuhk.edu.cn/', createdAt: '2026-09-30T00:00:00+08:00', updatedAt: '2026-09-30T00:00:00+08:00' }],
      reminders: [{ id: 'legacy-reminder', memoId: 'legacy-memo', title: '30', dueAt: '2026-09-30T00:00:00+08:00', recurrenceRule: null, status: 'pending', notificationSentAt: null, createdAt: '2026-09-30T00:00:00+08:00', updatedAt: '2026-09-30T00:00:00+08:00' }],
      blackboardItems: [{ id: 'url:https://bb.cuhk.edu.cn/', externalId: null, courseName: '未命名课程', courseCode: null, title: '30', itemType: 'other', dueAt: '2026-09-30T00:00:00+08:00', sourceUrl: 'https://bb.cuhk.edu.cn/' }],
      courseSchedules: [], syncRuns: [], externalMappings: [{ key: 'url:https://bb.cuhk.edu.cn/', externalId: null, memoId: 'legacy-memo', reminderId: 'legacy-reminder', sourceUrl: 'https://bb.cuhk.edu.cn/', updatedAt: '2026-09-30T00:00:00+08:00' }],
    });

    expect(repository.load().blackboardItems).toHaveLength(0);
    expect(repository.load().memos).toHaveLength(0);
    expect(repository.load().reminders).toHaveLength(0);

    repository.importBlackboardItems([{
      externalId: 'bb-real-1', courseName: 'CIE6007', courseCode: 'CIE6007', title: 'Homework 1', itemType: 'assignment', dueAt: '2026-10-08T23:59:00+08:00', sourceUrl: 'https://bb.cuhk.edu.cn/calendar/event/1',
    }]);

    const snapshot = repository.load();
    expect(snapshot.blackboardItems.map((item) => item.title)).toEqual(['Homework 1']);
    expect(snapshot.memos.map((item) => item.title)).toEqual(['Homework 1']);
    expect(snapshot.reminders.map((item) => item.title)).toEqual(['Homework 1']);
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

    expect(first).toEqual({ addedMemos: 4, addedReminders: 6, addedBlackboardItems: 1, addedSchedules: 2 });
    expect(firstSnapshot.memos).toHaveLength(4);
    expect(firstSnapshot.reminders).toHaveLength(6);
    expect(firstSnapshot.blackboardItems).toHaveLength(1);
    expect(firstSnapshot.reminders.every((item) => item.dueAt.startsWith('2026-09-'))).toBe(true);

    const second = repository.seedDemoData(new Date('2026-09-29T12:00:00+08:00'));
    expect(second).toEqual({ addedMemos: 0, addedReminders: 0, addedBlackboardItems: 0, addedSchedules: 0 });
    expect(repository.load().memos).toHaveLength(4);
    expect(repository.load().reminders).toHaveLength(6);
  });

  it('imports recurring Blackboard course schedules idempotently', () => {
    const first = repository.importBlackboardSchedules([{
      externalId: 'class-1', courseName: 'MATH 101', courseCode: 'MATH101', weekday: 2,
      startTime: '09:00', endTime: '10:30', location: 'YIA LT6', sourceUrl: 'https://bb/course/1',
    }]);
    const second = repository.importBlackboardSchedules([{
      externalId: 'class-1', courseName: 'MATH 101', courseCode: 'MATH101', weekday: 2,
      startTime: '09:00', endTime: '10:30', location: 'YIA LT6', sourceUrl: 'https://bb/course/1',
    }]);

    expect(first).toEqual({ newCount: 1, updatedCount: 0, existingCount: 0 });
    expect(second).toEqual({ newCount: 0, updatedCount: 0, existingCount: 1 });
    expect(repository.load().courseSchedules).toHaveLength(1);
    expect(repository.load().courseSchedules?.[0]).toMatchObject({ weekday: 2, startTime: '09:00', endTime: '10:30', location: 'YIA LT6', source: 'blackboard' });
  });

  it('imports archive course schedules with term metadata and updates by UID', () => {
    const first = repository.importCourseSchedules([{
      externalId: 'class-archive-1', courseName: 'AIR5212 - Introduction to Haptics', courseCode: 'AIR5212', weekday: 1,
      startTime: '14:00', endTime: '16:50', location: 'Teaching D Bldg 102', sourceUrl: 'archive://AIR5212.ICS',
      startDate: '2026-09-07', endDate: '2026-12-14', recurrenceRule: 'FREQ=WEEKLY',
    }], 'archive');
    const second = repository.importCourseSchedules([{
      externalId: 'class-archive-1', courseName: 'AIR5212 - Introduction to Haptics', courseCode: 'AIR5212', weekday: 1,
      startTime: '14:00', endTime: '17:00', location: 'Teaching D Bldg 102', sourceUrl: 'archive://AIR5212.ICS',
      startDate: '2026-09-07', endDate: '2026-12-14', recurrenceRule: 'FREQ=WEEKLY',
    }], 'archive');

    expect(first).toEqual({ newCount: 1, updatedCount: 0, existingCount: 0 });
    expect(second).toEqual({ newCount: 0, updatedCount: 1, existingCount: 0 });
    expect(repository.load().courseSchedules?.[0]).toMatchObject({ source: 'archive', endTime: '17:00', endDate: '2026-12-14' });
  });
});
