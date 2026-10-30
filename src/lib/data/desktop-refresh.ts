export interface AsyncSnapshotLoader {
  loadAsync(): Promise<unknown>;
}

/**
 * Return the first day of the month represented by an inbound reminder date.
 * The value is parsed from its local date components so a timezone offset
 * cannot move an item into an adjacent month on the host machine.
 */
export function monthStartForDueAt(value: string): Date | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return new Date(year, month - 1, 1);
}

export function createDesktopSnapshotReloader(
  repository: AsyncSnapshotLoader,
  onLoaded: () => void,
): () => Promise<void> {
  let pending: Promise<void> | null = null;

  return () => {
    if (pending) return pending;
    pending = repository.loadAsync()
      .then(() => { onLoaded(); })
      .finally(() => { pending = null; });
    return pending;
  };
}
