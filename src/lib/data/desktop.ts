import { invoke } from '@tauri-apps/api/core';
import type { AppSnapshot, PersistenceDriver, StorageLike } from './repository';

export type InvokeFn = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export class DesktopPersistenceDriver implements PersistenceDriver {
  constructor(private readonly call: InvokeFn = invoke) {}

  load(): Promise<AppSnapshot> {
    return this.call<AppSnapshot>('load_snapshot');
  }

  save(snapshot: AppSnapshot): Promise<void> {
    return this.call<void>('save_snapshot', { snapshot });
  }
}

export function createDesktopPersistenceDriver(call: InvokeFn = invoke): DesktopPersistenceDriver {
  return new DesktopPersistenceDriver(call);
}

export function tauriStorage(): StorageLike {
  let cached: string | null = null;
  return {
    getItem: () => cached,
    setItem: (_key, value) => { cached = value; },
    removeItem: () => { cached = null; },
  };
}
