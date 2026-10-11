import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReminderEditor from '../../src/components/ReminderEditor.svelte';

const { openUrlMock } = vi.hoisted(() => ({ openUrlMock: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: openUrlMock }));

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe('ReminderEditor', () => {
  it('shows colored complete and delete actions for an existing item', async () => {
    const onComplete = vi.fn();
    const onDelete = vi.fn();
    render(ReminderEditor, {
      onSave: vi.fn(), onComplete, onDelete, existingMemoId: 'memo-1', existingReminderId: 'reminder-1',
    });

    const footerActions = screen.getByRole('group', { name: '事项操作' });
    expect(footerActions).toHaveClass('editor-footer-actions');
    const complete = within(footerActions).getByRole('button', { name: '完成' });
    const remove = within(footerActions).getByRole('button', { name: '删除' });
    expect(complete).toHaveClass('complete-action');
    expect(remove).toHaveClass('delete-action');

    await fireEvent.click(complete);
    await fireEvent.click(remove);
    expect(onComplete).toHaveBeenCalledWith({ memoId: 'memo-1', reminderId: 'reminder-1' });
    expect(onDelete).toHaveBeenCalledWith({ memoId: 'memo-1', reminderId: 'reminder-1' });
  });

  it('does not show complete or delete actions for a new item', () => {
    render(ReminderEditor, { onSave: vi.fn() });
    expect(screen.queryByRole('button', { name: '完成' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument();
  });

  it('renders the Blackboard source action outside the rich-text body', () => {
    render(ReminderEditor, {
      onSave: vi.fn(),
      initial: { title: 'Homework', sourceUrl: 'https://bb.cuhk.edu.cn/webapps/assignment/uploadAssignment?content_id=_1&course_id=_2', sourceKind: 'assignment', body: '<p><strong>Blackboard 课程</strong></p>' },
    });

    const body = screen.getByLabelText('正文');
    expect(body).toHaveTextContent('Blackboard 课程');
    expect(body).not.toHaveTextContent('打开作业');
    expect(body).not.toHaveTextContent('<p>');
    expect(screen.getByRole('button', { name: '↗ 打开作业' })).toBeInTheDocument();
  });

  it('does not offer an assignment action for an unresolved event link', () => {
    render(ReminderEditor, { onSave: vi.fn(), initial: { title: 'Assignment', sourceUrl: 'https://bb.cuhk.edu.cn/calendar/event/one', sourceKind: 'event', body: '<p>assignment</p>' } });
    expect(screen.queryByRole('button', { name: '↗ 打开作业' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('尚未定位到作业提交页');
  });

  it('emits a memo with a reminder when the user submits the form', async () => {
    const onSave = vi.fn();
    render(ReminderEditor, { onSave });

    await fireEvent.input(screen.getByLabelText('标题'), { target: { value: '买咖啡豆' } });
    const body = screen.getByLabelText('正文');
    body.innerHTML = '周末采购';
    await fireEvent.input(body);
    await fireEvent.input(screen.getByLabelText('提醒时间'), { target: { value: '2026-10-05T09:00' } });
    await fireEvent.click(screen.getByRole('button', { name: '保存备忘录' }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      title: '买咖啡豆',
      body: '周末采购',
      reminderAt: '2026-10-05T09:00',
    }));
  });

  it('provides rich-text toolbar actions for bold and list formatting', async () => {
    render(ReminderEditor, { onSave: vi.fn() });

    const body = screen.getByLabelText('正文');
    body.innerHTML = '课程重点';
    await fireEvent.input(body);
    await fireEvent.click(screen.getByRole('button', { name: '加粗' }));
    expect(body.innerHTML).toContain('<strong>课程重点</strong>');

    await fireEvent.click(screen.getByRole('button', { name: '项目列表' }));
    expect(body.innerHTML).toContain('<ul><li>课程重点</li></ul>');
  });

  it('uses the styled category menu and exposes a header close action', async () => {
    render(ReminderEditor, { onSave: vi.fn() });

    const category = screen.getByRole('combobox', { name: '分类' });
    await fireEvent.click(category);
    expect(screen.getByRole('option', { name: '课程' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('option', { name: '课程' }));
    expect(category).toHaveTextContent('课程');
    expect(screen.getByRole('button', { name: '关闭编辑器' })).toBeInTheDocument();
  });
});
