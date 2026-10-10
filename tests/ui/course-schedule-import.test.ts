import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CourseScheduleImportDialog from '../../src/components/CourseScheduleImportDialog.svelte';

const { getCurrentWebviewMock, invokeMock } = vi.hoisted(() => ({
  getCurrentWebviewMock: vi.fn(),
  invokeMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: getCurrentWebviewMock }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

const ics = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:air-1\r\nSUMMARY:AIR5212 - Introduction to Haptics\r\nDTSTART;TZID="中国标准时间":20260907T140000\r\nDTEND;TZID="中国标准时间":20260907T165000\r\nRRULE:FREQ=WEEKLY;COUNT=15;BYDAY=MO\r\nLOCATION:Teaching D Bldg 102\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

afterEach(() => {
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.clearAllMocks();
});

describe('CourseScheduleImportDialog', () => {
  it('previews courses after selecting a ZIP file', async () => {
    render(CourseScheduleImportDialog);
    const archive = zipSync({ 'AIR5212.ICS': strToU8(ics) });
    const file = new File([archive], 'Class_Schedule.zip', { type: 'application/zip' });

    await fireEvent.change(screen.getByLabelText('课表 ZIP 文件'), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText('AIR5212 - Introduction to Haptics')).toBeInTheDocument());
    expect(screen.getByText(/1 节课程 · 1 个 ICS 文件/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认导入' })).toBeInTheDocument();
  });

  it('accepts a ZIP file dropped onto the drop zone', async () => {
    render(CourseScheduleImportDialog);
    const archive = zipSync({ 'AIR5212.ICS': strToU8(ics) });
    const file = new File([archive], 'Class_Schedule.zip', { type: 'application/zip' });

    await fireEvent.drop(screen.getByRole('region', { name: '拖放课表 ZIP 文件' }), { dataTransfer: { files: [file] } });

    await waitFor(() => expect(screen.getByText('AIR5212 - Introduction to Haptics')).toBeInTheDocument());
    expect(screen.getByText(/1 节课程 · 1 个 ICS 文件/)).toBeInTheDocument();
  });

  it('explains when a dropped file is not a ZIP', async () => {
    render(CourseScheduleImportDialog);
    const file = new File(['not a zip'], 'notes.txt', { type: 'text/plain' });

    await fireEvent.drop(screen.getByRole('region', { name: '拖放课表 ZIP 文件' }), { dataTransfer: { files: [file] } });

    expect(await screen.findByRole('alert')).toHaveTextContent('只能导入 ZIP 格式的课表文件。');
  });

  it('reads a native Tauri file drop by path', async () => {
    const archive = zipSync({ 'AIR5212.ICS': strToU8(ics) });
    const path = 'C:\\Users\\Litbug\\Downloads\\Class_Schedule.zip';
    const onDragDropEvent = vi.fn().mockResolvedValue(vi.fn());
    getCurrentWebviewMock.mockReturnValue({ onDragDropEvent });
    invokeMock.mockResolvedValue(Array.from(archive));
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });

    render(CourseScheduleImportDialog);
    await waitFor(() => expect(onDragDropEvent).toHaveBeenCalled());
    const handler = onDragDropEvent.mock.calls[0][0] as (event: { payload: { type: string; paths?: string[] } }) => void;
    handler({ payload: { type: 'drop', paths: [path] } });

    await waitFor(() => expect(screen.getByText('AIR5212 - Introduction to Haptics')).toBeInTheDocument());
    expect(invokeMock).toHaveBeenCalledWith('read_schedule_archive', { path });
  });
});
