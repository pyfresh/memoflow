import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
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
    await fireEvent.input(screen.getByLabelText('正文'), { target: { value: '整理本周课程文件' } });
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

  it('closes the editor by clicking the surrounding overlay', async () => {
    render(App);
    await fireEvent.click(screen.getByRole('button', { name: '＋ 新建备忘录' }));
    expect(screen.getByRole('dialog', { name: '编辑备忘录' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('presentation'));
    expect(screen.queryByRole('dialog', { name: '编辑备忘录' })).not.toBeInTheDocument();
  });

  it('exposes Blackboard sync, export and search controls', () => {
    render(App);
    expect(screen.getByRole('button', { name: /同步 Blackboard/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /导出 Markdown/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '搜索备忘录' })).toBeInTheDocument();
  });

  it('loads virtual demo data from the sidebar', async () => {
    render(App);
    await fireEvent.click(screen.getByRole('button', { name: /加载示例数据/ }));

    await waitFor(() => expect(screen.getByText('线性代数项目规划')).toBeInTheDocument());
    expect(screen.getByText(/已加载 4 条备忘录、6 条提醒和 2 节课程/)).toBeInTheDocument();
  });

});
