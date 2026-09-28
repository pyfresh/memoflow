import { describe, expect, it } from 'vitest';
import { exportMemosToMarkdown, exportMemosToPlainText } from '../../src/lib/export/markdown';
import type { AppSnapshot } from '../../src/lib/data/repository';

describe('memo export', () => {
  const snapshot: AppSnapshot = {
    memos: [{
      id: 'm1',
      title: '旅行清单',
      richText: '<p>护照和充电器</p>',
      categoryId: 'life',
      tags: ['旅行'],
      source: 'manual',
      externalItemId: null,
      sourceUrl: null,
      createdAt: '2026-09-28T10:00:00+08:00',
      updatedAt: '2026-09-28T10:00:00+08:00',
    }],
    reminders: [{
      id: 'r1',
      memoId: 'm1',
      title: '旅行清单',
      dueAt: '2026-10-05T09:00:00+08:00',
      recurrenceRule: null,
      status: 'pending',
      notificationSentAt: null,
      createdAt: '2026-09-28T10:00:00+08:00',
      updatedAt: '2026-09-28T10:00:00+08:00',
    }],
    blackboardItems: [],
    syncRuns: [],
    externalMappings: [],
  };

  it('exports markdown with reminder metadata', () => {
    expect(exportMemosToMarkdown(snapshot)).toContain('- 提醒：2026-10-05T09:00:00+08:00');
    expect(exportMemosToMarkdown(snapshot)).toContain('护照和充电器');
  });

  it('exports plain text without HTML tags', () => {
    const text = exportMemosToPlainText(snapshot);
    expect(text).toContain('旅行清单');
    expect(text).toContain('护照和充电器');
    expect(text).not.toContain('<p>');
  });
});
