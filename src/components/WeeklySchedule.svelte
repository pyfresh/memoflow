<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { CourseScheduleEntry } from '$lib/domain/types';
  import { addDays, formatScheduleDate, getWeekdayLabel, startOfWeek } from '$lib/domain/schedule';
  import { getScheduleGridPosition } from '$lib/domain/schedule-grid';

  export let entries: CourseScheduleEntry[] = [];
  export let weekStart: Date = startOfWeek(new Date());

  const GRID_START = '08:30';
  const PIXELS_PER_HOUR = 40;
  const TRACK_HEIGHT = 14 * PIXELS_PER_HOUR;
  const TIME_LABELS = ['08:30', '09:30', '10:30', '11:30', '12:30', '13:30', '14:30', '15:30', '16:30', '17:30', '18:30', '19:30', '20:30', '21:30'];
  const dispatch = createEventDispatcher<{ weekChange: Date; importZip: void }>();
  $: days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  $: visibleDays = days.slice(0, 5);
  $: weekEnd = days[6];
  $: weekLabel = `${weekStart.getFullYear()} 年 ${weekStart.getMonth() + 1} 月 ${weekStart.getDate()} 日 - ${weekEnd.getMonth() + 1} 月 ${weekEnd.getDate()} 日`;

  function dateKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function entriesFor(weekday: number): CourseScheduleEntry[] {
    const key = dateKey(days[weekday - 1]);
    return entries.filter((entry) => entry.weekday === weekday && (!entry.startDate || key >= entry.startDate) && (!entry.endDate || key <= entry.endDate)).sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  function isToday(date: Date): boolean {
    const today = new Date();
    return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  }

  function courseTone(entry: CourseScheduleEntry): string {
    const code = entry.courseCode?.toUpperCase() ?? '';
    if (code.startsWith('AIR')) return 'tone-air';
    if (code.startsWith('CIE6007')) return 'tone-cie';
    if (code.startsWith('CIE')) return 'tone-data';
    if (code.startsWith('AIS6002')) return 'tone-ais';
    if (code.startsWith('AIS')) return 'tone-quantum';
    return 'tone-default';
  }

  function courseStyle(entry: CourseScheduleEntry): string {
    const position = getScheduleGridPosition(entry.startTime, entry.endTime, GRID_START, PIXELS_PER_HOUR);
    return `top:${position.top}px;height:${Math.max(position.height, 48)}px`;
  }

  function shiftWeek(offset: number) {
    dispatch('weekChange', addDays(weekStart, offset * 7));
  }

  function goToToday() {
    dispatch('weekChange', startOfWeek(new Date()));
  }
</script>

<section class="schedule-page" aria-label="周课表">
  <header class="schedule-header">
    <div>
      <p class="workspace-kicker">课程安排</p>
      <h1 class="workspace-title">周课表</h1>
      <h2 class="schedule-range">{weekLabel}</h2>
    </div>
    <div class="schedule-actions">
      <button type="button" class="import-button" on:click={() => dispatch('importZip')}>导入课表 ZIP</button>
      <button type="button" aria-label="上一周" on:click={() => shiftWeek(-1)}>←</button>
      <button type="button" aria-label="本周" class="today-button" on:click={goToToday}>本周</button>
      <button type="button" aria-label="下一周" on:click={() => shiftWeek(1)}>→</button>
    </div>
  </header>

  {#if entries.length === 0}
    <div class="schedule-empty">
      <span class="empty-mark">□</span>
      <p>导入课表 ZIP 后，这里会显示你的每周课程。</p>
      <small>课程时段来自学校课表文件，Blackboard 作业导入不会自动生成课程表。</small>
    </div>
  {:else}
    <div class="grid-scroll">
      <div class="time-grid" style={`--track-height:${TRACK_HEIGHT}px`}>
        <div class="corner">时间</div>
        {#each visibleDays as day, index}
          <div class:today={isToday(day)} class="day-head">
            <span>{getWeekdayLabel(index + 1)}</span>
            <strong>{formatScheduleDate(day)}</strong>
          </div>
        {/each}

        <div class="time-labels">
          {#each TIME_LABELS as label}
            <div class="time-label">{label}</div>
          {/each}
        </div>
        {#each visibleDays as day, index}
          <section class:today={isToday(day)} class="day-track" aria-label={`${getWeekdayLabel(index + 1)} ${formatScheduleDate(day)}`}>
            {#each entriesFor(index + 1) as entry (entry.id)}
              <article class={`course-block ${courseTone(entry)}`} style={courseStyle(entry)}>
                <strong>{entry.courseCode ?? entry.courseName}</strong>
                <span class="course-name">{entry.courseName}</span>
                <span class="course-time">{entry.startTime} - {entry.endTime}</span>
                {#if entry.location}<span class="course-location">{entry.location}</span>{/if}
              </article>
            {/each}
          </section>
        {/each}
      </div>
    </div>
  {/if}
</section>

<style>
  .schedule-page { min-width:0; }
  .schedule-header { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; margin-bottom:26px; }
  .schedule-range { margin:12px 0 0; color:var(--ink-soft); font-size:.95rem; font-weight:650; }
  .schedule-actions { display:flex; gap:8px; }
  .schedule-actions button { min-width:38px; height:38px; border:1px solid var(--line); border-radius:8px; background:var(--surface); color:var(--ink-soft); box-shadow:var(--shadow-sm); }
  .schedule-actions button:hover { border-color:var(--accent); color:var(--accent-strong); }
  .schedule-actions .import-button { padding:0 12px; color:var(--accent-strong); font-size:.76rem; font-weight:700; }
  .schedule-actions .today-button { padding:0 12px; font-size:.78rem; font-weight:700; }
  .grid-scroll { overflow-x:auto; border:1px solid var(--line); border-radius:10px; background:var(--surface); box-shadow:var(--shadow-sm); }
  .time-grid { display:grid; grid-template-columns:72px repeat(5,minmax(150px,1fr)); min-width:850px; }
  .corner, .day-head { border-right:1px solid var(--line); border-bottom:1px solid var(--line); background:var(--surface-subtle); }
  .corner { position:sticky; left:0; z-index:4; display:grid; place-items:center; color:var(--ink-muted); font-size:.72rem; font-weight:800; }
  .day-head { min-height:58px; padding:11px 7px; text-align:center; }
  .day-head.today { background:var(--accent-soft); }
  .day-head span, .day-head strong { display:block; }
  .day-head span { color:var(--ink-soft); font-size:.75rem; font-weight:800; }
  .day-head strong { margin-top:2px; color:var(--ink-muted); font-size:.7rem; font-weight:600; }
  .time-labels { background:#fbfdfc; }
  .time-label { height:40px; border-right:1px solid var(--line); border-bottom:1px solid var(--line); padding:10px 8px 0; color:var(--ink-muted); font-size:.68rem; font-weight:700; text-align:right; }
  .day-track { position:relative; height:var(--track-height); border-right:1px solid var(--line); background:repeating-linear-gradient(to bottom,transparent 0,transparent 39px,var(--line) 39px,var(--line) 40px); }
  .day-track:last-child { border-right:0; }
  .day-track.today { background-color:rgba(223,243,238,.28); }
  .day-track:after { content:""; position:absolute; inset:0; pointer-events:none; background:repeating-linear-gradient(to bottom,transparent 0,transparent 19px,rgba(216,228,224,.45) 19px,rgba(216,228,224,.45) 20px); }
  .course-block { position:absolute; left:6px; right:6px; z-index:1; overflow:hidden; border:1px solid rgba(35,74,66,.16); border-left:4px solid rgba(35,74,66,.38); border-radius:7px; padding:8px 8px 7px; color:var(--ink); box-shadow:0 5px 10px rgba(33,68,63,.08); }
  .course-block strong, .course-block span { display:block; }
  .course-block strong { overflow:hidden; font-size:.76rem; font-weight:850; text-overflow:ellipsis; white-space:nowrap; }
  .course-name { margin-top:2px; overflow:hidden; color:var(--ink-soft); font-size:.64rem; text-overflow:ellipsis; white-space:nowrap; }
  .course-time { margin-top:6px; color:var(--accent-strong); font-size:.69rem; font-weight:850; }
  .course-location { margin-top:2px; overflow:hidden; color:var(--ink-soft); font-size:.62rem; text-overflow:ellipsis; white-space:nowrap; }
  .tone-air { background:#dbeec4; }.tone-cie { background:#cfe8f1; }.tone-data { background:#f7e6c3; }.tone-ais { background:#e8ddf7; }.tone-quantum { background:#f5d8d4; }.tone-default { background:var(--accent-soft); }
  .schedule-empty { display:grid; place-items:center; min-height:360px; border:1px dashed var(--line-strong); border-radius:10px; color:var(--ink-muted); text-align:center; }
  .schedule-empty p { margin:10px 0 4px; color:var(--ink-soft); font-size:.88rem; }
  .schedule-empty small { max-width:360px; font-size:.73rem; line-height:1.55; }
  .empty-mark { display:grid; place-items:center; width:38px; height:38px; border:1px dashed var(--line-strong); border-radius:50%; color:var(--accent); }
  @media (max-width:900px) { .schedule-header { align-items:flex-start; flex-direction:column; } .grid-scroll { margin-right:-6px; } }
</style>
