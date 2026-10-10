import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BlackboardImportDialog from '../../src/components/BlackboardImportDialog.svelte';

const { invokeMock, listenMock } = vi.hoisted(() => ({ invokeMock: vi.fn(), listenMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

describe('BlackboardImportDialog page mode', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenMock.mockResolvedValue(() => {});
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
  });

  it('only offers the authenticated Blackboard page import', () => {
    render(BlackboardImportDialog);
    expect(screen.getByRole('heading', { name: '从 Blackboard 导入作业' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开 Blackboard 登录' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '通过 iCal 链接导入' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Blackboard iCal 链接' })).not.toBeInTheDocument();
  });
});
