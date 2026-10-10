import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it } from 'vitest';
import App from '../../src/routes/App.svelte';

describe('countdown page', () => {
  beforeEach(() => localStorage.clear());

  it('opens the countdown page and creates a circular countdown card', async () => {
    render(App);
    await fireEvent.click(screen.getByRole('button', { name: '倒计时' }));
    expect(screen.getByRole('heading', { name: '倒计时' })).toBeInTheDocument();

    await fireEvent.input(screen.getByLabelText('倒计时名称'), { target: { value: '专注写作' } });
    await fireEvent.input(screen.getByLabelText('小时'), { target: { value: '0' } });
    await fireEvent.input(screen.getByLabelText('分钟'), { target: { value: '1' } });
    await fireEvent.input(screen.getByLabelText('秒'), { target: { value: '30' } });
    await fireEvent.click(screen.getByRole('button', { name: /创建倒计时/ }));

    await waitFor(() => expect(screen.getByRole('article', { name: '专注写作' })).toBeInTheDocument());
    expect(screen.getByText('00:01:30')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /开始/ })).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '专注写作 剩余进度' })).toBeInTheDocument();
  });
});
