import { describe, expect, it, vi } from 'vitest';
import { createDesktopSnapshotReloader, monthStartForDueAt } from '../../src/lib/data/desktop-refresh';

describe('desktop snapshot refresh', () => {
  it('keeps an inbound due date in its local calendar month', () => {
    expect(monthStartForDueAt('2026-11-02T15:00:00+08:00')).toEqual(new Date(2026, 10, 1));
    expect(monthStartForDueAt('2026-10-31T23:59:00Z')).toEqual(new Date(2026, 9, 1));
    expect(monthStartForDueAt('2026-02-30T15:00:00+08:00')).toBeNull();
    expect(monthStartForDueAt('not-a-date')).toBeNull();
  });

  it('reloads the desktop snapshot before notifying the UI', async () => {
    const loadAsync = vi.fn().mockResolvedValue(undefined);
    const onLoaded = vi.fn();
    const reload = createDesktopSnapshotReloader({ loadAsync }, onLoaded);

    await reload();

    expect(loadAsync).toHaveBeenCalledTimes(1);
    expect(onLoaded).toHaveBeenCalledTimes(1);
    expect(loadAsync.mock.invocationCallOrder[0]).toBeLessThan(onLoaded.mock.invocationCallOrder[0]);
  });

  it('coalesces simultaneous reload requests', async () => {
    let resolveLoad!: () => void;
    const loadAsync = vi.fn(() => new Promise<void>((resolve) => { resolveLoad = resolve; }));
    const onLoaded = vi.fn();
    const reload = createDesktopSnapshotReloader({ loadAsync }, onLoaded);

    const first = reload();
    const second = reload();
    expect(loadAsync).toHaveBeenCalledTimes(1);

    resolveLoad();
    await Promise.all([first, second]);
    expect(onLoaded).toHaveBeenCalledTimes(1);
  });
});
