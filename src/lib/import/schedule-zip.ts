import { unzipSync } from 'fflate';
import type { ScheduleCandidate } from '../domain/types';
import { parseIcalFeed } from './ical';

export interface ScheduleZipError {
  fileName: string;
  message: string;
}

export interface ScheduleZipParseResult {
  schedules: ScheduleCandidate[];
  errors: ScheduleZipError[];
  fileCount: number;
}

function scheduleKey(schedule: ScheduleCandidate): string {
  return schedule.externalId?.trim()
    ? `id:${schedule.externalId.trim()}`
    : `${schedule.courseCode ?? schedule.courseName}|${schedule.weekday}|${schedule.startTime}|${schedule.endTime}`.toLowerCase();
}

export function parseCourseScheduleZip(bytes: Uint8Array): ScheduleZipParseResult {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error('课表 ZIP 无法读取，可能已损坏或格式不受支持');
  }

  const entries = Object.entries(files).filter(([name, data]) => !name.endsWith('/') && data.length > 0 && name.toLowerCase().endsWith('.ics'));
  if (entries.length === 0) throw new Error('压缩包内没有找到 .ics 课程文件');

  const schedules = new Map<string, ScheduleCandidate>();
  const errors: ScheduleZipError[] = [];
  const decoder = new TextDecoder('utf-8');
  for (const [fileName, data] of entries) {
    try {
      const parsed = parseIcalFeed(decoder.decode(data), `archive://${encodeURIComponent(fileName)}`);
      if (parsed.schedules.length === 0) {
        errors.push({ fileName, message: '没有识别到每周重复的课程时段' });
        continue;
      }
      for (const schedule of parsed.schedules) schedules.set(scheduleKey(schedule), schedule);
    } catch (error) {
      errors.push({ fileName, message: error instanceof Error ? error.message : '无法解析 ICS 文件' });
    }
  }
  return { schedules: [...schedules.values()], errors, fileCount: entries.length };
}
