import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../../src/routes/App.svelte';

describe('MemoFlow dashboard', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('opens the memo editor and shows a saved reminder in recent items', async () => {
    render(App);
    await fireEvent.click(screen.getByRole('button', { name: '＋ 新建' }));

    await fireEvent.input(screen.getByLabelText('标题'), { target: { value: '准备课程资料' } });
    await fireEvent.input(screen.getByLabelText('正文'), { target: { value: '整理本周课程文件' } });
    await fireEvent.input(screen.getByLabelText('提醒时间'), { target: { value: '2026-10-05T09:00' } });
    await fireEvent.click(screen.getByRole('button', { name: '保存备忘录' }));

    await waitFor(() => expect(screen.getByText('准备课程资料')).toBeInTheDocument());
    expect(screen.getByRole('region', { name: '月历' })).toBeInTheDocument();
  });

  it('creates a standalone reminder without adding a memo', async () => {
    render(App);
    await fireEvent.click(screen.getByRole('button', { name: '新建提醒' }));
    await fireEvent.input(screen.getByLabelText('标题'), { target: { value: '打电话' } });
    await fireEvent.input(screen.getByLabelText('提醒时间'), { target: { value: '2026-10-05T09:00' } });
    await fireEvent.click(screen.getByRole('button', { name: '保存提醒' }));
    await waitFor(() => expect(screen.getByText('打电话')).toBeInTheDocument());
    const snapshot = JSON.parse(localStorage.getItem('memoflow.snapshot.v1') ?? '{}');
    expect(snapshot.memos).toHaveLength(0);
    expect(snapshot.reminders).toHaveLength(1);
  });

  it('exposes Blackboard sync, export and search controls', () => {
    render(App);
    expect(screen.getByRole('button', { name: /同步 Blackboard/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /导出 Markdown/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '搜索备忘录' })).toBeInTheDocument();
  });
});



