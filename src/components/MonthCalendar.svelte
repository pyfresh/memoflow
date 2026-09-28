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
    </div>
    <div class="calendar-actions">
      <button type="button" aria-label="上个月" on:click={() => changeMonth(-1)}>‹</button>
      <button type="button" aria-label="今天" on:click={goToday}>今天</button>
      <button type="button" aria-label="下个月" on:click={() => changeMonth(1)}>›</button>
    </div>
  </header>

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
          {#each visibleItems(cell).slice(0, 3) as item}
            <button type="button" class="calendar-item {item.kind}" on:click={() => dispatch('select', item)} title={item.title}>
              <span>{item.title}</span>
              {#if item.time}<small>{item.time}</small>{/if}
            </button>
          {/each}
        </div>
      </div>
    {/each}
  </div>
</section>

<style>
  .calendar-panel { min-width: 0; }
  .calendar-header { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; margin-bottom:18px; }
  .eyebrow { margin:0 0 5px; color:var(--ink-muted); font-size:.75rem; letter-spacing:.08em; text-transform:uppercase; }
  h2 { margin:0; font-size:1.55rem; letter-spacing:-.04em; }
  .calendar-actions { display:flex; gap:7px; }
  .calendar-actions button { min-width:36px; height:36px; border:1px solid var(--line); border-radius:10px; background:var(--surface); color:var(--ink-soft); cursor:pointer; }
  .calendar-actions button:hover { border-color:var(--accent); color:var(--accent); }
  .weekdays, .calendar-grid { display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); }
  .weekdays { padding:0 8px 8px; color:var(--ink-muted); font-size:.72rem; text-align:right; }
  .calendar-grid { overflow:hidden; border:1px solid var(--line); border-radius:15px; background:var(--line); gap:1px; }
  .calendar-cell { min-height:92px; padding:9px; background:var(--surface); }
  .calendar-cell.outside { background:#f7f8fc; color:#adb6c5; }
  .calendar-cell.today .day-number { display:inline-grid; place-items:center; width:26px; height:26px; border-radius:50%; background:var(--accent); color:white; }
  .day-number { display:block; margin-left:auto; width:26px; height:26px; text-align:center; line-height:26px; font-size:.78rem; font-weight:650; }
  .cell-items { display:flex; flex-direction:column; gap:4px; margin-top:5px; }
  .calendar-item { display:flex; flex-direction:column; gap:1px; width:100%; overflow:hidden; border:0; border-radius:6px; padding:5px 6px; text-align:left; font:inherit; font-size:.68rem; cursor:pointer; }
  .calendar-item span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .calendar-item small { opacity:.75; }
  .calendar-item.course { background:#fff0ed; color:#bd5b53; }
  .calendar-item.reminder { background:#eef2ff; color:#5366d2; }
  .calendar-item.note { background:#edf7f1; color:#39815d; }
  @media (max-width:900px) { .calendar-cell { min-height:78px; padding:6px; } .calendar-item { font-size:.62rem; } }
</style>


