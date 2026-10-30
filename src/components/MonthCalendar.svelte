<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { buildMonthGrid } from '$lib/domain/calendar';
  import type { CalendarCell, CalendarItem } from '$lib/domain/types';
  export let month: Date = new Date();
  export let items: CalendarItem[] = [];

  const dispatch = createEventDispatcher<{ monthChange: Date; select: CalendarItem }>();
  let currentMonth = new Date(month.getFullYear(), month.getMonth(), 1);

  $: cells = buildMonthGrid(currentMonth.getFullYear(), currentMonth.getMonth() + 1);
  $: monthTitle = `${currentMonth.getFullYear()} 年 ${currentMonth.getMonth() + 1} 月`;
  $: itemMap = items.reduce<Record<string, CalendarItem[]>>((map, item) => {
    (map[item.date] ??= []).push(item);
    return map;
  }, {});

  function changeMonth(delta: number) {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + delta, 1);
    dispatch('monthChange', currentMonth);
  }

  function goToday() {
    currentMonth = new Date();
    currentMonth.setDate(1);
    dispatch('monthChange', currentMonth);
  }

  function visibleItems(cell: CalendarCell) {
    return itemMap[cell.date] ?? [];
  }
</script>

<section class="calendar-panel" aria-label="月历">
  <header class="calendar-header">
    <div>
      <p class="eyebrow">课程与提醒</p>
      <h2>{monthTitle}</h2>
      <p class="calendar-caption">{items.length ? `${items.length} 个事项落在这个月` : '这个月还没有安排'}</p>
    </div>
    <div class="calendar-actions">
      <button type="button" aria-label="上个月" on:click={() => changeMonth(-1)}>‹</button>
      <button class="today-button" type="button" aria-label="今天" on:click={goToday}>今天</button>
      <button type="button" aria-label="下个月" on:click={() => changeMonth(1)}>›</button>
    </div>
  </header>

  <div class="calendar-legend" aria-label="日历图例">
    <span><i class="legend-dot course"></i>课程</span>
    <span><i class="legend-dot reminder"></i>提醒</span>
    <span><i class="legend-dot completed"></i>已完成</span>
  </div>

  <div class="weekdays" aria-hidden="true">
    {#each ['一', '二', '三', '四', '五', '六', '日'] as weekday}
      <span>周{weekday}</span>
    {/each}
  </div>

  <div class="calendar-grid" role="grid" aria-label={monthTitle}>
    {#each cells as cell}
      <div class:outside={!cell.isCurrentMonth} class:today={cell.isToday} class="calendar-cell" data-testid={"calendar-cell-" + cell.date} role="gridcell">
        <span class="day-number">{Number(cell.date.slice(-2))}</span>
        <div class="cell-items">
          {#each visibleItems(cell).slice(0, 3) as item (item.id + ':' + item.status)}
            <button type="button" class="calendar-item {item.kind} {item.status === 'completed' ? 'completed' : 'pending'}" on:click={() => dispatch('select', item)} title={item.title}>
              <span>{item.title}</span>
              {#if item.time}<small>{item.time}</small>{/if}
            </button>
          {/each}
          {#if visibleItems(cell).length > 3}<span class="more-items">+{visibleItems(cell).length - 3} 项</span>{/if}
        </div>
      </div>
    {/each}
  </div>
</section>

<style>
  .calendar-panel { min-width:0; }
  .calendar-header { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; margin-bottom:10px; }
  .eyebrow { margin:0 0 5px; color:var(--accent); font-size:.68rem; font-weight:750; letter-spacing:.12em; text-transform:uppercase; }
  h2 { margin:0; font-size:1.58rem; letter-spacing:-.045em; }
  .calendar-caption { margin:7px 0 0; color:var(--ink-muted); font-size:.78rem; }
  .calendar-actions { display:flex; gap:6px; }
  .calendar-actions button { min-width:36px; height:36px; border:1px solid var(--line); border-radius:8px; background:var(--surface); color:var(--ink-soft); cursor:pointer; box-shadow:var(--shadow-sm); }
  .calendar-actions button:hover { border-color:var(--accent); color:var(--accent); }
  .calendar-actions .today-button { min-width:52px; color:var(--accent-strong); font-size:.74rem; font-weight:750; }
  .calendar-legend { display:flex; gap:14px; margin:0 0 12px; color:var(--ink-muted); font-size:.7rem; }
  .calendar-legend span { display:inline-flex; align-items:center; gap:6px; }
  .legend-dot { width:7px; height:7px; border-radius:50%; background:var(--accent); }
  .legend-dot.course { background:var(--highlight); }
  .legend-dot.reminder { background:#6675d8; }
  .legend-dot.completed { background:#2e8064; }
  .weekdays, .calendar-grid { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); }
  .weekdays { padding:0 8px 8px; color:var(--ink-muted); font-size:.7rem; text-align:right; }
  .calendar-grid { overflow:hidden; border:1px solid var(--line); border-radius:10px; background:var(--line); gap:1px; box-shadow:var(--shadow-sm); }
  .calendar-cell { min-height:108px; padding:9px; background:var(--surface); }
  .calendar-cell.outside { background:#f3f6f3; color:#aab7b3; }
  .calendar-cell.today { background:#fbfffd; }
  .calendar-cell.today .day-number { display:inline-grid; place-items:center; width:26px; height:26px; border-radius:7px; background:var(--accent); color:white; }
  .day-number { display:block; margin-left:auto; width:26px; height:26px; text-align:center; line-height:26px; font-size:.78rem; font-weight:700; }
  .cell-items { display:flex; flex-direction:column; gap:4px; margin-top:5px; }
  .calendar-item { display:flex; flex-direction:column; gap:1px; width:100%; overflow:hidden; border:0; border-left:3px solid var(--accent); border-radius:4px; padding:5px 6px; text-align:left; font:inherit; font-size:.68rem; cursor:pointer; }
  .calendar-item span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .calendar-item small { opacity:.75; }
  .calendar-item.course { border-left-color:var(--highlight); background:#fff0e9; color:#a65339; }
  .calendar-item.reminder { border-left-color:#6675d8; background:#edf1ff; color:#3f51a3; }
  .calendar-item.note { background:#edf7f1; color:var(--success); }
  .calendar-item.completed { border-left-color:#2e8064; background:#e7f4ed; color:#24664f; }
  .more-items { color:var(--ink-muted); font-size:.63rem; }
  @media (max-width:900px) { .calendar-cell { min-height:82px; padding:6px; } .calendar-item { font-size:.62rem; } }
</style>
