<script lang="ts">
  import { onMount } from 'svelte';
  import BlackboardImportDialog from '../components/BlackboardImportDialog.svelte';
  import MonthCalendar from '../components/MonthCalendar.svelte';
  import RecentItems from '../components/RecentItems.svelte';
  import ReminderEditor from '../components/ReminderEditor.svelte';
  import Sidebar from '../components/Sidebar.svelte';
  import type { CalendarItem, RecentItem } from '$lib/domain/types';
  import type { MemoDraft } from '$lib/data/repository';
  import { createBrowserRepository, type AppSnapshot } from '$lib/data/repository';
  import { getReminderOccurrences } from '$lib/domain/reminders';
  import { startReminderScheduler } from '$lib/reminders/scheduler';
  import { notifyReminder } from '$lib/notifications';
  import { createDesktopPersistenceDriver } from '$lib/data/desktop';
  import { exportMemosToMarkdown } from '$lib/export/markdown';
  import { exportMemosToPlainText } from '$lib/export/markdown';

  const desktopPersistence = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? createDesktopPersistenceDriver() : undefined;
  const repository = createBrowserRepository(desktopPersistence);
  let snapshot: AppSnapshot = repository.load();
  let currentMonth = new Date();
  let query = '';
  let categoryFilter = 'all';
  let showEditor = false;
  let showImporter = false;
  let editingDraft: Partial<MemoDraft> = {};
  let editingId: string | null = null;

  function monthBounds(date: Date): [string, string] {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
  }

  $: recentItems = snapshot.reminders
    .map((reminder): RecentItem => {
      const memo = snapshot.memos.find((item) => item.id === reminder.memoId);
      const title = memo?.title ?? reminder.title;
      const source = memo?.source ?? 'manual';
      const category = memo?.source === 'blackboard' ? '课程' : memo?.categoryId === 'course' ? '课程' : memo ? '生活' : '提醒';
      return {
        id: reminder.id,
        memoId: memo?.id ?? '',
        title,
        dueAt: reminder.dueAt,
        source,
        status: reminder.status,
        category,
        searchText: [title, memo?.richText ?? '', memo?.tags?.join(' ') ?? ''].join(' '),
      };
    })
    .filter((item) => {
      const matchesQuery = !query || item.title.toLowerCase().includes(query.toLowerCase()) || (item.searchText ?? '').toLowerCase().includes(query.toLowerCase());
      const matchesCategory = categoryFilter === 'all' || (categoryFilter === 'course' && item.category === '课程') || (categoryFilter === 'life' && item.category === '生活');
      return matchesQuery && matchesCategory;
    })
    .sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''))
    .slice(0, 7);

  $: {
    const [rangeStart, rangeEnd] = monthBounds(currentMonth);
    calendarItems = snapshot.reminders.flatMap((reminder): CalendarItem[] => {
      const memo = snapshot.memos.find((item) => item.id === reminder.memoId);
      return getReminderOccurrences(reminder, rangeStart, rangeEnd).map((occurrence) => ({
        id: reminder.id,
        date: occurrence.slice(0, 10),
        title: memo?.title ?? reminder.title,
        kind: memo?.source === 'blackboard' ? 'course' : 'reminder',
        time: occurrence.slice(11, 16),
      }));
    });
  }
  let calendarItems: CalendarItem[] = [];

  function refresh() {
    snapshot = repository.load();
  }

  function openNewMemo() {
    editingId = null;
    editingDraft = {};
    showEditor = true;
  }

  function openNewReminder() {
    editingId = null;
    editingDraft = { standalone: true };
    showEditor = true;
  }

  function editItem(event: CustomEvent<RecentItem>) {
    const memo = snapshot.memos.find((item) => item.id === event.detail.memoId);
    const reminder = snapshot.reminders.find((item) => item.memoId === event.detail.memoId);
    if (!memo) return;
    editingId = memo.id;
    editingDraft = {
      title: memo.title,
      body: memo.richText,
      reminderAt: reminder?.dueAt.slice(0, 16) ?? '',
      recurrenceRule: reminder?.recurrenceRule ?? null,
    };
    showEditor = true;
  }

  function saveMemo(event: CustomEvent<MemoDraft>) {
    if (event.detail.standalone) {
      repository.saveReminderDraft({ title: event.detail.title, dueAt: event.detail.reminderAt, recurrenceRule: event.detail.recurrenceRule, memoId: null });
    } else {
      repository.saveMemoDraft({ ...event.detail, id: editingId ?? undefined });
    }
    showEditor = false;
    refresh();
    void repository.flush();
  }

  function updateStatus(event: CustomEvent<{ item: RecentItem; status: 'completed' | 'ignored' }>) {
    repository.setReminderStatus(event.detail.item.id, event.detail.status);
    refresh();
    void repository.flush();
  }

  function selectCalendarItem(event: CustomEvent<CalendarItem>) {
    const reminder = snapshot.reminders.find((item) => item.id === event.detail.id);
    if (reminder) editItem(new CustomEvent('select', { detail: { id: reminder.id, memoId: reminder.memoId!, title: event.detail.title, dueAt: reminder.dueAt, source: 'manual', status: reminder.status, category: '提醒' } }));
  }

  function handleImport(event: CustomEvent<void>) {
    showImporter = true;
  }

  function confirmImport(event: CustomEvent<import('$lib/domain/types').ImportCandidate[]>) {
    repository.importBlackboardItems(event.detail);
    showImporter = false;
    refresh();
    void repository.flush();
  }

  function exportData() {
    const blob = new Blob([exportMemosToMarkdown(snapshot)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'memoflow-notes.md';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportPlainText() {
    const blob = new Blob([exportMemosToPlainText(snapshot)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'memoflow-notes.txt';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  onMount(() => {
    let stop: (() => void) | undefined;
    const initialize = async () => {
      if (desktopPersistence) await repository.loadAsync();
      refresh();
      const schedulerStop = startReminderScheduler(repository, (reminder) => { void notifyReminder(reminder); });
      stop = schedulerStop;
    };
    void initialize();
    return () => stop?.();
  });
</script>

<svelte:head>
  <title>MemoFlow · 备忘录与提醒</title>
  <meta name="description" content="个人备忘录、月历和课程提醒" />
</svelte:head>

<svelte:window on:keydown={(event) => event.key === 'n' && (event.ctrlKey || event.metaKey) && openNewMemo()} />

<div class="app-shell">
  <h1 class="sr-only">MemoFlow</h1>
  <Sidebar on:newMemo={openNewMemo} on:newReminder={openNewReminder} on:importBlackboard={handleImport} on:exportData={exportData} on:exportPlainText={exportPlainText} />

  <main class="workspace">
    <header class="workspace-header">
      <div>
        <p class="workspace-kicker">个人工作台</p>
        <h1 class="workspace-title">今天要做什么？</h1>
        <p class="workspace-subtitle">让每个提醒都有一个清晰的下一步。</p>
      </div>
      <div class="header-tools">
        <input class="search-box" aria-label="搜索备忘录" placeholder="搜索备忘录…" bind:value={query} />

<select class="filter-select" aria-label="筛选分类" bind:value={categoryFilter}>
          <option value="all">全部分类</option>
          <option value="course">课程</option>
          <option value="life">生活</option>
        </select>
        <button class="primary-button" type="button" on:click={openNewMemo}>＋ 新建</button>
      </div>
    </header>

    <section class="dashboard">
      <RecentItems items={recentItems} {query} on:select={editItem} on:status={updateStatus} />
      <MonthCalendar month={currentMonth} items={calendarItems} on:monthChange={(event) => (currentMonth = event.detail)} on:select={selectCalendarItem} />
    </section>
  </main>
</div>

{#if showEditor}
  <div class="overlay">
    <div class="modal" role="dialog" aria-modal="true" aria-label="编辑备忘录">
      <ReminderEditor initial={editingDraft} on:save={saveMemo} />
      <button class="close-button" type="button" aria-label="关闭编辑器" on:click={() => (showEditor = false)}>×</button>
    </div>
  </div>
{/if}

{#if showImporter}
  <div class="overlay">
    <div class="modal" role="dialog" aria-modal="true" aria-label="导入 Blackboard">
      <BlackboardImportDialog on:close={() => (showImporter = false)} on:confirm={confirmImport} />
    </div>
  </div>
{/if}
















