import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BlackboardImportDialog from '../../src/components/BlackboardImportDialog.svelte';

const { invokeMock, listenMock } = vi.hoisted(() => ({ invokeMock: vi.fn(), listenMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

const feed = `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:assignment-1\nSUMMARY:Assignment 1\nDTEND:20261008T235900\nCATEGORIES:MATH 101,assignment\nEND:VEVENT\nBEGIN:VEVENT\nUID:class-math-1\nSUMMARY:MATH 101 Lecture\nDTSTART:20261006T090000\nDTEND:20261006T103000\nRRULE:FREQ=WEEKLY;BYDAY=TU\nX-BB-CALENDAR-NAME:MATH 101\nEND:VEVENT\nBEGIN:VEVENT\nUID:personal-1\nSUMMARY:Personal appointment\nDTSTART:20261010T120000\nDTEND:20261010T130000\nCATEGORIES:Personal\nEND:VEVENT\nBEGIN:VEVENT\nUID:missing-summary\nDTSTART:20261011T090000\nEND:VEVENT\nEND:VCALENDAR`;

describe('BlackboardImportDialog iCal mode', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockResolvedValue(() => {});
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
  });

  it('offers a URL import mode and rejects an invalid URL before invoking Tauri', async () => {
    render(BlackboardImportDialog);
    await fireEvent.click(screen.getByRole('button', { name: '通过 iCal 链接导入' }));
    expect(screen.getByRole('textbox', { name: 'Blackboard iCal 链接' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: '读取 iCal' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请粘贴 Blackboard');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('reads the feed, shows all candidates, and reports skipped events', async () => {
    invokeMock.mockResolvedValue(feed);
    render(BlackboardImportDialog);
    await fireEvent.click(screen.getByRole('button', { name: '通过 iCal 链接导入' }));
    await fireEvent.input(screen.getByRole('textbox', { name: 'Blackboard iCal 链接' }), { target: { value: 'https://bb.cuhk.edu.cn/webapps/calendar/calendarFeed/token/learn.ics' } });
    await fireEvent.click(screen.getByRole('button', { name: '读取 iCal' }));

    await waitFor(() => expect(screen.getByText(/发现 3 个事项/)).toBeInTheDocument());
    expect(screen.getAllByText(/跳过 1 条/).length).toBeGreaterThan(0);
    expect(screen.getByText('Assignment 1')).toBeInTheDocument();
    expect(screen.getByText('MATH 101 Lecture')).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith('fetch_blackboard_ical', { url: 'https://bb.cuhk.edu.cn/webapps/calendar/calendarFeed/token/learn.ics' });
  });

  it('keeps confirmation disabled for an empty feed and explains the state', async () => {
    invokeMock.mockResolvedValue('BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR');
    render(BlackboardImportDialog);
    await fireEvent.click(screen.getByRole('button', { name: '通过 iCal 链接导入' }));
    await fireEvent.input(screen.getByRole('textbox', { name: 'Blackboard iCal 链接' }), { target: { value: 'https://bb.cuhk.edu.cn/calendarFeed/token.ics' } });
    await fireEvent.click(screen.getByRole('button', { name: '读取 iCal' }));
    await waitFor(() => expect(screen.getByText(/没有可导入的事项/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '确认导入' })).toBeDisabled();
  });
});
