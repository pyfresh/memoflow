import { describe, expect, it } from 'vitest';
import { classifyImportCandidate, dedupeImportCandidates, normalizeExternalItem } from '../../src/lib/import/normalize';

describe('normalizeExternalItem', () => {
  it('normalizes a Blackboard calendar item to the local shape', () => {
    expect(normalizeExternalItem({
      externalId: 'bb-42',
      courseName: 'MATH 101',
      courseCode: 'MATH101',
      title: 'Project 1',
      itemType: 'Assignment',
      dueAt: '2026-10-08 23:59',
      sourceUrl: 'https://bb.cuhk.edu.cn/item/42',
    })).toMatchObject({
      externalId: 'bb-42',
      courseName: 'MATH 101',
      title: 'Project 1',
      itemType: 'assignment',
      dueAt: '2026-10-08T23:59:00+08:00',
    });
  });

  it('keeps supported recurrence frequencies and clears unsupported rules', () => {
    expect(normalizeExternalItem({ title: 'Weekly', dueAt: '2026-10-08 09:00', recurrenceRule: 'DTSTART=20261008;FREQ=WEEKLY', sourceUrl: 'https://bb.cuhk.edu.cn/item/weekly' })).toMatchObject({ recurrenceRule: 'FREQ=WEEKLY' });
    expect(normalizeExternalItem({ title: 'Hourly', dueAt: '2026-10-08 09:00', recurrenceRule: 'FREQ=HOURLY', sourceUrl: 'https://bb.cuhk.edu.cn/item/hourly' }).recurrenceRule).toBeNull();
  });
});

describe('classifyImportCandidate', () => {
  it('uses the external id first and preserves local edits when an item is updated', () => {
    const candidate = normalizeExternalItem({
      externalId: 'bb-42',
      courseName: 'MATH 101',
      title: 'Project 1 (updated)',
      itemType: 'Assignment',
      dueAt: '2026-10-09 23:59',
      sourceUrl: 'https://bb.cuhk.edu.cn/item/42',
    });

    expect(classifyImportCandidate(candidate, [{
      ...candidate,
      title: 'Project 1',
      dueAt: '2026-10-08T23:59:00+08:00',
      localMemoContent: '<p>My notes</p>',
    }])).toEqual('updated');
  });

  it('falls back to source URL, course and title when no external id exists', () => {
    const candidate = normalizeExternalItem({
      externalId: null,
      courseName: 'CSC 201',
      title: 'Assignment 2',
      itemType: 'Project',
      dueAt: '2026-10-12 18:00',
      sourceUrl: 'https://bb.cuhk.edu.cn/item/88',
    });

    expect(classifyImportCandidate(candidate, [{
      ...candidate,
      externalId: null,
      localMemoContent: '',
    }])).toEqual('existing');
  });
});

describe('dedupeImportCandidates', () => {
  it('keeps the last Blackboard update for the same external id', () => {
    const candidates = [
      normalizeExternalItem({
        externalId: 'bb-1',
        courseName: 'MATH 101',
        title: 'Project 1',
        itemType: 'Assignment',
        dueAt: '2026-10-08 23:59',
        sourceUrl: 'https://bb.cuhk.edu.cn/item/1',
      }),
      normalizeExternalItem({
        externalId: 'bb-1',
        courseName: 'MATH 101',
        title: 'Project 1',
        itemType: 'Assignment',
        dueAt: '2026-10-09 23:59',
        sourceUrl: 'https://bb.cuhk.edu.cn/item/1',
      }),
    ];

    expect(dedupeImportCandidates(candidates)).toHaveLength(1);
    expect(dedupeImportCandidates(candidates)[0].dueAt).toBe('2026-10-09T23:59:00+08:00');
  });
});
