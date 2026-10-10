import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../../src/routes/App.svelte';

describe('MemoFlow dashboard', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('opens the memo editor and shows a saved reminder in recent items', async () => {
    render(App);
    await fireEvent.click(screen.getByRole('button', { name: '＋ 新建备忘录' }));

    await fireEvent.input(screen.getByLabelText('标题'), { target: { value: '准备课程资料' } });
    const body = screen.getByLabelText('正文');
    body.innerHTML = '整理本周课程文件';
    await fireEvent.input(body);
    await fireEvent.input(screen.getByLabelText('提醒时间'), { target: { value: '2026-10-05T09:00' } });
    await fireEvent.click(screen.getByRole('button', { name: '保存备忘录' }));

    await waitFor(() => expect(screen.getByText('准备课程资料')).toBeInTheDocument());
    expect(screen.getByRole('region', { name: '月历' })).toBeInTheDocument();
  });

  it('creates a standalone reminder without adding a memo', async () => {
    render(App);
    await fireEvent.click(screen.getByRole('button', { name: '＋ 新建提醒' }));
    await fireEvent.input(screen.getByLabelText('标题'), { target: { value: '打电话' } });
    await fireEvent.input(screen.getByLabelText('提醒时间'), { target: { value: '2026-10-05T09:00' } });
    await fireEvent.click(screen.getByRole('button', { name: '保存提醒' }));
    await waitFor(() => expect(screen.getByText('打电话')).toBeInTheDocument());
    const snapshot = JSON.parse(localStorage.getItem('memoflow.snapshot.v1') ?? '{}');
    expect(snapshot.memos).toHaveLength(0);
    expect(snapshot.reminders).toHaveLength(1);
  });

  it('navigates between overview, memo and reminder pages', async () => {
    render(App);
    await fireEvent.click(screen.getByRole('button', { name: '备忘录' }));
    expect(screen.getByRole('heading', { name: '备忘录' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '＋ 新建备忘录' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '月历' })).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: '提醒' }));
    expect(screen.getByRole('heading', { name: '提醒' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '＋ 新建提醒' })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: '快速一览' }));
    expect(screen.getByRole('region', { name: '月历' })).toBeInTheDocument();
  });

  it('opens the weekly schedule and removes the category navigation', async () => {
    render(App);
    expect(screen.queryByText('分类')).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: '周课表' }));
    expect(screen.getByRole('heading', { name: '周课表' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: '筛选分类' })).not.toBeInTheDocument();
  });

  it('opens the course schedule ZIP importer from the weekly schedule', async () => {
    render(App);
    await fireEvent.click(screen.getByRole('button', { name: '周课表' }));
    await fireEvent.click(screen.getByRole('button', { name: '导入课表 ZIP' }));
    expect(screen.getByRole('dialog', { name: '导入课表 ZIP' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '选择课表 ZIP' })).toBeInTheDocument();
  });

  it('closes the editor by clicking the surrounding overlay', async () => {
    render(App);
    await fireEvent.click(screen.getByRole('button', { name: '＋ 新建备忘录' }));
    expect(screen.getByRole('dialog', { name: '编辑备忘录' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('presentation'));
    expect(screen.queryByRole('dialog', { name: '编辑备忘录' })).not.toBeInTheDocument();
  });

  it('opens calendar item details with complete and delete actions', async () => {
    localStorage.setItem('memoflow.snapshot.v1', JSON.stringify({
      memos: [{
        id: 'memo-calendar', title: 'Homework 1', richText: '<p>Read chapter 1</p>', categoryId: 'course', tags: ['assignment', 'AIS6002'],
        source: 'blackboard', externalItemId: 'bb-calendar', sourceUrl: 'https://bb/item/calendar', sourceKind: 'assignment',
        createdAt: '2026-10-01T00:00:00+08:00', updatedAt: '2026-10-01T00:00:00+08:00',
      }],
      reminders: [{
        id: 'reminder-calendar', memoId: 'memo-calendar', title: 'Homework 1', dueAt: '2026-10-08T23:59:00+08:00',
        notificationAt: '2026-10-07T23:59:00+08:00', recurrenceRule: null, status: 'pending', notificationSentAt: null,
        occurrenceHistory: [], createdAt: '2026-10-01T00:00:00+08:00', updatedAt: '2026-10-01T00:00:00+08:00',
      }],
      blackboardItems: [{
        id: 'id:bb-calendar', externalId: 'bb-calendar', courseName: 'AIS6002', courseCode: 'AIS6002', title: 'Homework 1', itemType: 'assignment',
        dueAt: '2026-10-08T23:59:00+08:00', sourceUrl: 'https://bb/item/calendar',
      }],
      courseSchedules: [], syncRuns: [], externalMappings: [],
    }));

    render(App);
    const calendar = screen.getByRole('region', { name: '月历' });
    await fireEvent.click(within(calendar).getByRole('button', { name: /Homework 1/ }));
    const dialog = screen.getByRole('dialog', { name: '编辑备忘录' });
    expect(within(dialog).getByRole('button', { name: '完成' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '删除' })).toBeInTheDocument();

    await fireEvent.click(within(dialog).getByRole('button', { name: '完成' }));
    const snapshot = JSON.parse(localStorage.getItem('memoflow.snapshot.v1') ?? '{}');
    expect(snapshot.reminders[0].status).toBe('completed');
  });

  it('deletes the selected calendar memo and its reminder', async () => {
    localStorage.setItem('memoflow.snapshot.v1', JSON.stringify({
      memos: [{
        id: 'memo-delete', title: 'Delete me', richText: '<p>Remove</p>', categoryId: 'life', tags: [], source: 'manual', externalItemId: null, sourceUrl: null,
        createdAt: '2026-10-01T00:00:00+08:00', updatedAt: '2026-10-01T00:00:00+08:00',
      }],
      reminders: [{
        id: 'reminder-delete', memoId: 'memo-delete', title: 'Delete me', dueAt: '2026-10-09T10:00:00+08:00', recurrenceRule: null, status: 'pending', notificationSentAt: null,
        occurrenceHistory: [], createdAt: '2026-10-01T00:00:00+08:00', updatedAt: '2026-10-01T00:00:00+08:00',
      }],
      blackboardItems: [], courseSchedules: [], syncRuns: [], externalMappings: [],
    }));

    render(App);
    const calendar = screen.getByRole('region', { name: '月历' });
    await fireEvent.click(within(calendar).getByRole('button', { name: /Delete me/ }));
    await fireEvent.click(within(screen.getByRole('dialog', { name: '编辑备忘录' })).getByRole('button', { name: '删除' }));
    const snapshot = JSON.parse(localStorage.getItem('memoflow.snapshot.v1') ?? '{}');
    expect(snapshot.memos).toHaveLength(0);
    expect(snapshot.reminders).toHaveLength(0);
  });

  it('exposes Blackboard sync, export and search controls', () => {
    render(App);
    expect(screen.getByRole('button', { name: /从 Blackboard 导入作业/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /导出 Markdown/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '搜索备忘录' })).toBeInTheDocument();
  });

  it('shows Blackboard type and course code tags in recent items', () => {
    localStorage.setItem('memoflow.snapshot.v1', JSON.stringify({
      memos: [{
        id: 'memo-bb', title: 'Homework 1', richText: '<p>assignment</p>', categoryId: 'course',
        tags: ['assignment', 'AIS6002'], source: 'blackboard', externalItemId: 'bb-1', sourceUrl: 'https://bb/item/1',
        createdAt: '2026-10-01T00:00:00+08:00', updatedAt: '2026-10-01T00:00:00+08:00',
      }],
      reminders: [{
        id: 'reminder-bb', memoId: 'memo-bb', title: 'Homework 1', dueAt: '2026-10-08T23:59:00+08:00',
        recurrenceRule: null, status: 'pending', notificationSentAt: null, occurrenceHistory: [],
        createdAt: '2026-10-01T00:00:00+08:00', updatedAt: '2026-10-01T00:00:00+08:00',
      }],
      blackboardItems: [{
        id: 'id:bb-1', externalId: 'bb-1', courseName: 'AIS6002:Science Foundation', courseCode: 'AIS6002',
        title: 'Homework 1', itemType: 'assignment', dueAt: '2026-10-08T23:59:00+08:00', sourceUrl: 'https://bb/item/1',
      }],
      courseSchedules: [], syncRuns: [], externalMappings: [],
    }));

    render(App);

    const recent = screen.getByRole('region', { name: '最近事项' });
    expect(within(recent).getByText('assignment')).toBeInTheDocument();
    expect(within(recent).getByText('AIS6002')).toBeInTheDocument();
    expect(within(recent).queryByText('课程')).not.toBeInTheDocument();
  });

  it('loads virtual demo data from the sidebar', async () => {
    render(App);
    await fireEvent.click(screen.getByRole('button', { name: /加载示例数据/ }));

    await waitFor(() => expect(screen.getByText('线性代数项目规划')).toBeInTheDocument());
    expect(screen.getByText(/已加载 4 条备忘录、6 条提醒和 2 节课程/)).toBeInTheDocument();
  });

});
