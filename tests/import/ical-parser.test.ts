import { describe, expect, it } from 'vitest';
import { parseIcalFeed } from '../../src/lib/import/ical';

const fixture = `BEGIN:VCALENDAR\nVERSION:2.0\nX-WR-CALNAME:Institution\nBEGIN:VEVENT\nUID:assignment-1@bb.cuhk.edu.cn\nSUMMARY:Assignment 1\nDTEND;TZID=Asia/Hong_Kong:20261008T235900\nDESCRIPTION:Read chapters 1\\, 2\\nand submit the report\nURL:https://bb.cuhk.edu.cn/ultra/courses/math/outline\nCATEGORIES:MATH 101,assignment\nEND:VEVENT\nBEGIN:VEVENT\nUID:class-math-1@bb.cuhk.edu.cn\nSUMMARY:MATH 101 Lecture\nDTSTART;TZID=Asia/Hong_Kong:20261006T090000\nDTEND;TZID=Asia/Hong_Kong:20261006T103000\nRRULE:FREQ=WEEKLY;BYDAY=TU\nLOCATION:YIA LT6\nX-BB-CALENDAR-NAME:MATH 101\nURL:https://bb.cuhk.edu.cn/ultra/courses/math\nEND:VEVENT\nBEGIN:VEVENT\nUID:personal-1@bb.cuhk.edu.cn\nSUMMARY:Personal appointment\nDTSTART:20261010T120000\nDTEND:20261010T130000\nCATEGORIES:Personal\nEND:VEVENT\nBEGIN:VEVENT\nUID:missing-summary@bb.cuhk.edu.cn\nDTSTART:20261011T090000\nEND:VEVENT\nEND:VCALENDAR`;
const feedUrl = 'https://bb.cuhk.edu.cn/webapps/calendar/calendarFeed/private-token/learn.ics';

describe('parseIcalFeed', () => {
  it('maps Blackboard events, decodes text, and extracts weekly classes', () => {
    const result = parseIcalFeed(fixture, feedUrl);

    expect(result.items).toHaveLength(3);
    expect(result.skippedCount).toBe(1);
    expect(result.items[0]).toMatchObject({
      externalId: 'assignment-1@bb.cuhk.edu.cn',
      title: 'Assignment 1',
      dueAt: '2026-10-08T23:59:00+08:00',
      courseName: 'MATH 101',
      itemType: 'assignment',
      localMemoContent: 'Read chapters 1, 2\nand submit the report',
      sourceUrl: 'https://bb.cuhk.edu.cn/ultra/courses/math/outline',
    });
    expect(result.items[1]).toMatchObject({
      externalId: 'class-math-1@bb.cuhk.edu.cn',
      recurrenceRule: 'FREQ=WEEKLY',
      dueAt: '2026-10-06T10:30:00+08:00',
    });
    expect(result.items[2]).toMatchObject({
      externalId: 'personal-1@bb.cuhk.edu.cn',
      courseName: 'Personal',
      dueAt: '2026-10-10T13:00:00+08:00',
      itemType: 'event',
    });
    expect(result.items[2].sourceUrl).not.toContain('private-token');
    expect(result.schedules).toEqual([expect.objectContaining({
      externalId: 'class-math-1@bb.cuhk.edu.cn',
      courseName: 'MATH 101',
      weekday: 2,
      startTime: '09:00',
      endTime: '10:30',
      location: 'YIA LT6',
      sourceUrl: 'https://bb.cuhk.edu.cn/ultra/courses/math',
    })]);
  });

  it('rejects non-calendar input', () => {
    expect(() => parseIcalFeed('<html></html>', feedUrl)).toThrow('不是有效的 iCalendar');
  });

  it('unfolds continued property lines before decoding escapes', () => {
    const folded = String.raw`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:folded
SUMMARY:Folded
DTSTART:20261008T090000
DESCRIPTION:First line\n
 second line
END:VEVENT
END:VCALENDAR`;
    expect(parseIcalFeed(folded, feedUrl).items[0].localMemoContent).toBe('First line\nsecond line');
  });
});
