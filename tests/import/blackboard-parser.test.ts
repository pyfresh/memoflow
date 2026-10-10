import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/blackboard-calendar.html?raw';
import fullCalendarFixture from '../fixtures/blackboard-fullcalendar.html?raw';
import fullCalendarOverlayFixture from '../fixtures/blackboard-fullcalendar-overlay.html?raw';
import monthGridFixture from '../fixtures/blackboard-month-grid.html?raw';
import assignmentDetailFixture from '../fixtures/blackboard-assignment-detail.html?raw';
import scheduleFixture from '../fixtures/blackboard-schedule.html?raw';
import { findBlackboardAssignmentUrl, parseBlackboardCalendarHtml, parseBlackboardScheduleHtml } from '../../src/lib/import/blackboard';

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

  it('extracts recurring course meeting rows and skips incomplete rows', () => {
    expect(parseBlackboardScheduleHtml(scheduleFixture, 'https://bb.cuhk.edu.cn/')).toEqual([
      {
        externalId: 'class-math',
        courseName: 'MATH 101',
        courseCode: 'MATH101',
        weekday: 2,
        startTime: '09:00',
        endTime: '10:30',
        location: 'YIA LT6',
        sourceUrl: 'https://bb.cuhk.edu.cn/webapps/blackboard/courses/math',
      },
    ]);
  });

  it('extracts FullCalendar events without importing date-cell links', () => {
    expect(parseBlackboardCalendarHtml(fullCalendarFixture, 'https://bb.cuhk.edu.cn/')).toEqual([
      {
        externalId: null,
        courseName: 'CIE6007: Machine Learning_L01L02',
        courseCode: 'CIE6007',
        title: 'Homework 1',
        itemType: 'assignment',
        dueAt: '2026-10-08T23:59:00+08:00',
        sourceUrl: 'https://bb.cuhk.edu.cn/calendar/event/101',
      },
      {
        externalId: null,
        courseName: 'AIS5007: Principles of Quantum Mechanics and Quantum Computation_L01',
        courseCode: 'AIS5007',
        title: 'Problem Set',
        itemType: 'assignment',
        dueAt: '2026-10-09T09:00:00+08:00',
        sourceUrl: 'https://bb.cuhk.edu.cn/calendar/event/202',
      },
      {
        externalId: null,
        courseName: 'CIE6007: Data Analytics_L02',
        courseCode: 'CIE6007',
        title: 'Assignment 1 - Xili',
        itemType: 'assignment',
        dueAt: '2026-10-19T00:00:00+08:00',
        sourceUrl: 'https://bb.cuhk.edu.cn/calendar/event/303',
      },
      {
        externalId: null,
        courseName: 'Blackboard 课程',
        courseCode: null,
        title: 'Project milestone',
        itemType: 'project',
        dueAt: '2026-10-20T00:00:00+08:00',
        sourceUrl: 'https://bb.cuhk.edu.cn/calendar/event/404',
      },
    ]);
  });

  it('extracts FullCalendar overlay events whose date is in the hidden event text', () => {
    expect(parseBlackboardCalendarHtml(fullCalendarOverlayFixture, 'https://bb.cuhk.edu.cn/')).toEqual([
      {
        externalId: null,
        courseName: 'Blackboard 课程',
        courseCode: null,
        title: 'Problem set 1',
        itemType: 'assignment',
        dueAt: '2026-10-09T00:00:00+08:00',
        sourceUrl: '',
      },
      {
        externalId: null,
        courseName: 'Blackboard 课程',
        courseCode: null,
        title: 'Homework 1 - Information Theory',
        itemType: 'assignment',
        dueAt: '2026-10-08T00:00:00+08:00',
        sourceUrl: '',
      },
      {
        externalId: null,
        courseName: 'Blackboard 课程',
        courseCode: null,
        title: 'Assignment 1 - Xili',
        itemType: 'assignment',
        dueAt: '2026-10-19T00:00:00+08:00',
        sourceUrl: '',
      },
    ]);
  });

  it('extracts legacy month-grid events whose date is only on the calendar cell', () => {
    expect(parseBlackboardCalendarHtml(monthGridFixture, 'https://bb.cuhk.edu.cn/')).toEqual([
      {
        externalId: null,
        courseName: 'Blackboard 课程',
        courseCode: null,
        title: 'Homework 1',
        itemType: 'assignment',
        dueAt: '2026-10-08T00:00:00+08:00',
        sourceUrl: '',
      },
      {
        externalId: 'problem-set',
        courseName: 'Blackboard 课程',
        courseCode: null,
        title: 'Problem Set',
        itemType: 'assignment',
        dueAt: '2026-10-09T00:00:00+08:00',
        sourceUrl: '',
      },
    ]);
  });

  it('extracts the real assignment target from an event detail page', () => {
    expect(findBlackboardAssignmentUrl(
      assignmentDetailFixture,
      'https://bb.cuhk.edu.cn/calendar/event/20260930T131035Z-_blackboard.platform.gradebook2.GradableItem-_110246_1%40BlackBoard-APP01',
      'Assignment 1 - Xili',
    )).toBe('https://bb.cuhk.edu.cn/webapps/assignment/uploadAssignment?content_id=_671598_1&course_id=_18493_1&group_id=&mode=view');
  });

  it('returns no target when the detail page has no assignment link', () => {
    expect(findBlackboardAssignmentUrl(
      '<main><a href="/webapps/portal/execute/tabs/tabAction?tab_tab_group_id=_1_1">课程首页</a></main>',
      'https://bb.cuhk.edu.cn/calendar/event/101',
      'Assignment 1 - Xili',
    )).toBeNull();
  });

  it('extracts an assignment target embedded in event JSON instead of falling back to the portal', () => {
    const html = `<script type="application/json">{"href":"/webapps/assignment/uploadAssignment?content_id=_671598_1&amp;course_id=_18493_1&amp;group_id=&amp;mode=view"}</script>`;
    expect(findBlackboardAssignmentUrl(
      html,
      'https://bb.cuhk.edu.cn/calendar/event/assignment-1',
      'Assignment 1 - Xili',
    )).toBe('https://bb.cuhk.edu.cn/webapps/assignment/uploadAssignment?content_id=_671598_1&course_id=_18493_1&group_id=&mode=view');
  });

  it('prefers a direct assignment URL exposed on a calendar event', () => {
    const html = '<article data-calendar-item data-assignment-url="/webapps/assignment/uploadAssignment?content_id=_671598_1&amp;course_id=_18493_1"><time datetime="2026-10-08T23:59:00+08:00"></time><a>Assignment 1 - Xili</a></article>';
    expect(parseBlackboardCalendarHtml(html, 'https://bb.cuhk.edu.cn/')[0].sourceUrl)
      .toBe('https://bb.cuhk.edu.cn/webapps/assignment/uploadAssignment?content_id=_671598_1&course_id=_18493_1');
  });
});
