import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/blackboard-calendar.html?raw';
import { parseBlackboardCalendarHtml } from '../../src/lib/import/blackboard';

describe('parseBlackboardCalendarHtml', () => {
  it('extracts only deadline items and resolves source links', () => {
    expect(parseBlackboardCalendarHtml(fixture, 'https://bb.cuhk.edu.cn/')).toEqual([
      {
        externalId: 'bb-a1',
        courseName: 'MATH 101',
        courseCode: 'MATH101',
        title: 'Project 1',
        itemType: 'assignment',
        dueAt: '2026-10-08T23:59:00+08:00',
        sourceUrl: 'https://bb.cuhk.edu.cn/webapps/blackboard/content/item/101',
      },
      {
        externalId: 'bb-e1',
        courseName: 'CSC 201',
        courseCode: 'CSC201',
        title: 'Midterm exam',
        itemType: 'exam',
        dueAt: '2026-10-12T18:00:00+08:00',
        sourceUrl: 'https://bb.cuhk.edu.cn/webapps/blackboard/content/item/202',
      },
    ]);
  });
});
