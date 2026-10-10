import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { parseCourseScheduleZip } from '../../src/lib/import/schedule-zip';

const courseIcs = (uid: string, summary: string, day: string, start: string, end: string, location: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${summary}\r\nDTSTART;TZID="中国标准时间":20260907T${start}\r\nDTEND;TZID="中国标准时间":20260907T${end}\r\nRRULE:FREQ=WEEKLY;COUNT=15;BYDAY=${day}\r\nLOCATION:${location}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

describe('parseCourseScheduleZip', () => {
  it('extracts all ICS course schedules without creating reminder items', () => {
    const archive = zipSync({
      'AIR5212.ICS': strToU8(courseIcs('air', 'AIR5212 - Introduction to Haptics', 'MO', '140000', '165000', 'Teaching D Bldg 102')),
      'CIE6007.ICS': strToU8(courseIcs('cie', 'CIE6007 - Machine Learning', 'TU', '180000', '193000', 'XILI CAMPUS 6E506')),
    });

    const result = parseCourseScheduleZip(archive);

    expect(result.schedules).toHaveLength(2);
    expect(result.schedules).toEqual(expect.arrayContaining([
      expect.objectContaining({ externalId: 'air', courseCode: 'AIR5212', weekday: 1, startTime: '14:00', endTime: '16:50', location: 'Teaching D Bldg 102' }),
      expect.objectContaining({ externalId: 'cie', courseCode: 'CIE6007', weekday: 2, startTime: '18:00', endTime: '19:30', location: 'XILI CAMPUS 6E506' }),
    ]));
    expect(result.errors).toEqual([]);
  });

  it('keeps valid courses when one ICS file is malformed', () => {
    const archive = zipSync({
      'valid.ics': strToU8(courseIcs('valid', 'AIS6002 - Science Foundation', 'TH', '143000', '173000', 'XILI CAMPUS 6A608')),
      'broken.ics': strToU8('not an ical document'),
    });

    const result = parseCourseScheduleZip(archive);

    expect(result.schedules).toHaveLength(1);
    expect(result.errors).toEqual([expect.objectContaining({ fileName: 'broken.ics' })]);
  });

});
