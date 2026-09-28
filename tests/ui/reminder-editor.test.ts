import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import ReminderEditor from '../../src/components/ReminderEditor.svelte';

describe('ReminderEditor', () => {
  it('emits a memo with a reminder when the user submits the form', async () => {
    const onSave = vi.fn();
    render(ReminderEditor, { onSave });

    await fireEvent.input(screen.getByLabelText('标题'), { target: { value: '买咖啡豆' } });
    await fireEvent.input(screen.getByLabelText('正文'), { target: { value: '周末采购' } });
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

    const body = screen.getByLabelText('正文') as HTMLTextAreaElement;
    await fireEvent.input(body, { target: { value: '课程重点' } });
    await fireEvent.click(screen.getByRole('button', { name: '加粗' }));
    expect(body.value).toContain('<strong>课程重点</strong>');

    await fireEvent.click(screen.getByRole('button', { name: '项目列表' }));
    expect(body.value).toContain('<ul><li>课程重点</li></ul>');
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