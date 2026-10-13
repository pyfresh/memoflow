import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import NotificationSettings from '../../src/components/NotificationSettings.svelte';

describe('NotificationSettings', () => {
  it('starts disabled and saves a configured PushPlus token', async () => {
    const onSave = vi.fn();
    render(NotificationSettings, { settings: { pushplusEnabled: false, pushplusToken: '' }, onSave });
    expect(screen.getByRole('checkbox', { name: '启用 PushPlus 微信提醒' })).not.toBeChecked();
    await fireEvent.click(screen.getByRole('checkbox', { name: '启用 PushPlus 微信提醒' }));
    await fireEvent.input(screen.getByLabelText('PushPlus Token'), { target: { value: 'token-123' } });
    await fireEvent.click(screen.getByRole('button', { name: '保存通知设置' }));
    expect(onSave).toHaveBeenCalledWith({ pushplusEnabled: true, pushplusToken: 'token-123' });
    expect(screen.getByRole('status')).toHaveTextContent('通知设置已保存');
  });

  it('rejects an enabled setting without a token and exposes test-send feedback', async () => {
    const onTest = vi.fn().mockResolvedValue(undefined);
    render(NotificationSettings, { settings: { pushplusEnabled: true, pushplusToken: '' }, onTest });
    await fireEvent.click(screen.getByRole('button', { name: '保存通知设置' }));
    expect(screen.getByRole('status')).toHaveTextContent('请输入 PushPlus Token');
    await fireEvent.input(screen.getByLabelText('PushPlus Token'), { target: { value: 'token-123' } });
    await fireEvent.click(screen.getByRole('button', { name: '发送测试提醒' }));
    expect(onTest).toHaveBeenCalledWith('token-123');
    expect(await screen.findByRole('status')).toHaveTextContent('测试提醒已发送');
  });
});
