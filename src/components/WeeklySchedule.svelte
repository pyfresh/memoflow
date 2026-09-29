<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { CourseScheduleEntry } from '$lib/domain/types';
  import { addDays, formatScheduleDate, getWeekdayLabel, startOfWeek } from '$lib/domain/schedule';

  export let entries: CourseScheduleEntry[] = [];
  export let weekStart: Date = startOfWeek(new Date());

  const dispatch = createEventDispatcher<{ weekChange: Date }>();
  $: days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  $: weekEnd = days[6];
  $: weekLabel = `${weekStart.getFullYear()} 年 ${weekStart.getMonth() + 1} 月 ${weekStart.getDate()} 日 - ${weekEnd.getMonth() + 1} 月 ${weekEnd.getDate()} 日`;

  function entriesFor(weekday: number): CourseScheduleEntry[] {
    return entries.filter((entry) => entry.weekday === weekday).sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  function isToday(date: Date): boolean {
    const today = new Date();
    return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
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
      <button type="button" aria-label="上一周" on:click={() => shiftWeek(-1)}>←</button>
      <button type="button" aria-label="本周" class="today-button" on:click={goToToday}>本周</button>
      <button type="button" aria-label="下一周" on:click={() => shiftWeek(1)}>→</button>
    </div>
  </header>

  {#if entries.length === 0}
    <div class="schedule-empty">
      <span class="empty-mark">□</span>
      <p>同步 Blackboard 后，这里会显示你的每周课程。</p>
      <small>课程时段来自 Blackboard 课程日历，上课时间不会由作业截止时间推测。</small>
    </div>
  {:else}
    <div class="week-grid">
      {#each days as day, index}
        <section class:today={isToday(day)} class="day-column" aria-label={`${getWeekdayLabel(index + 1)} ${formatScheduleDate(day)}`}>
          <header class="day-header">
            <span>{getWeekdayLabel(index + 1)}</span>
            <strong>{formatScheduleDate(day)}</strong>
          </header>
          <div class="day-content">
            {#if entriesFor(index + 1).length === 0}
              <span class="day-empty">无课程</span>
            {:else}
              {#each entriesFor(index + 1) as entry (entry.id)}
                <article class="course-card">
                  <strong>{entry.courseName}</strong>
                  {#if entry.courseCode}<span class="course-code">{entry.courseCode}</span>{/if}
                  <span class="course-time">{entry.startTime} - {entry.endTime}</span>
                  {#if entry.location}<span class="course-location">{entry.location}</span>{/if}
                </article>
              {/each}
            {/if}
          </div>
        </section>
      {/each}
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
  .schedule-actions .today-button { padding:0 12px; font-size:.78rem; font-weight:700; }
  .week-grid { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:10px; align-items:stretch; }
  .day-column { min-width:0; min-height:360px; overflow:hidden; border:1px solid var(--line); border-radius:10px; background:var(--surface); box-shadow:var(--shadow-sm); }
  .day-column.today { border-color:var(--accent); box-shadow:0 0 0 2px var(--accent-soft); }
  .day-header { display:flex; align-items:center; justify-content:space-between; gap:6px; padding:13px 12px; border-bottom:1px solid var(--line); background:var(--surface-subtle); color:var(--ink-muted); font-size:.72rem; }
  .day-header strong { color:var(--ink); font-size:.78rem; }
  .day-content { display:flex; flex-direction:column; gap:8px; padding:10px; }
  .day-empty { padding:25px 4px; color:var(--ink-muted); font-size:.72rem; text-align:center; }
  .course-card { display:flex; flex-direction:column; gap:5px; border-left:3px solid var(--accent); border-radius:5px; padding:10px 9px; background:var(--accent-soft); }
  .course-card strong { overflow:hidden; color:var(--ink); font-size:.78rem; text-overflow:ellipsis; white-space:nowrap; }
  .course-code, .course-location { color:var(--ink-muted); font-size:.68rem; }
  .course-time { color:var(--accent-strong); font-size:.7rem; font-weight:750; }
  .schedule-empty { display:grid; place-items:center; min-height:360px; border:1px dashed var(--line-strong); border-radius:10px; color:var(--ink-muted); text-align:center; }
  .schedule-empty p { margin:10px 0 4px; color:var(--ink-soft); font-size:.88rem; }
  .schedule-empty small { max-width:360px; font-size:.73rem; line-height:1.55; }
  .empty-mark { display:grid; place-items:center; width:38px; height:38px; border:1px dashed var(--line-strong); border-radius:50%; color:var(--accent); }
  @media (max-width:1100px) { .week-grid { gap:6px; } .day-header { padding:11px 8px; } .day-content { padding:7px; } }
  @media (max-width:900px) { .schedule-header { align-items:flex-start; flex-direction:column; } .week-grid { overflow-x:auto; grid-template-columns:repeat(7,minmax(128px,1fr)); padding-bottom:8px; } }
</style>
