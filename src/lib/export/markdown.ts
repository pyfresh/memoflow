import type { AppSnapshot } from '../data/repository';

function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

export function exportMemosToMarkdown(snapshot: AppSnapshot): string {
  const lines = ['# MemoFlow 备忘录', ''];
  for (const memo of snapshot.memos) {
    lines.push(`## ${memo.title}`, '', plainText(memo.richText), '');
    const reminder = snapshot.reminders.find((item) => item.memoId === memo.id);
    if (reminder) {
      lines.push(`- 提醒：${reminder.dueAt}`);
      if (reminder.recurrenceRule) lines.push(`- 重复：${reminder.recurrenceRule}`);
    }
    if (memo.sourceUrl) lines.push(`- 来源：${memo.sourceUrl}`);
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}

export function exportMemosToPlainText(snapshot: AppSnapshot): string {
  return snapshot.memos.map((memo) => {
    const reminder = snapshot.reminders.find((item) => item.memoId === memo.id);
    return [
      memo.title,
      plainText(memo.richText),
      reminder ? `提醒：${reminder.dueAt}` : '',
      memo.sourceUrl ? `来源：${memo.sourceUrl}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');
}
