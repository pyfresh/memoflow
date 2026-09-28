<script lang="ts">
  import { onMount } from 'svelte';
  import BlackboardImportDialog from '../components/BlackboardImportDialog.svelte';
  import MemoList from '../components/MemoList.svelte';
  import MonthCalendar from '../components/MonthCalendar.svelte';
  import RecentItems from '../components/RecentItems.svelte';
  import ReminderEditor from '../components/ReminderEditor.svelte';
  import SelectMenu from '../components/SelectMenu.svelte';
  import Sidebar from '../components/Sidebar.svelte';
  import type { View } from '$lib/domain/navigation';
  import type { CalendarItem, Memo, RecentItem } from '$lib/domain/types';
  import type { MemoDraft } from '$lib/data/repository';
  import { createBrowserRepository, type AppSnapshot } from '$lib/data/repository';
  import { getReminderOccurrences } from '$lib/domain/reminders';
  import { startReminderScheduler } from '$lib/reminders/scheduler';
  import { notifyReminder } from '$lib/notifications';
  import { createDesktopPersistenceDriver } from '$lib/data/desktop';
  import { exportMemosToMarkdown, exportMemosToPlainText } from '$lib/export/markdown';

  const desktopPersistence = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? createDesktopPersistenceDriver() : undefined;
  const repository = createBrowserRepository(desktopPersistence);
  let snapshot: AppSnapshot = repository.load();
  let currentMonth = new Date();
  let activeView: View = 'overview';
  let query = '';
  let categoryFilter = 'all';
  const categoryOptions = [
    { value: 'all', label: '全部分类' },
    { value: 'course', label: '课程' },
    { value: 'life', label: '生活' },
    { value: 'inbox', label: '待整理' },
  ];
  let showEditor = false;
  let showImporter = false;
  let editingDraft: Partial<MemoDraft> = {};
  let editingId: string | null = null;

  let allReminderItems: RecentItem[] = [];
  let filteredReminderItems: RecentItem[] = [];
  let recentItems: RecentItem[] = [];
  let memoItems: Memo[] = [];
  let calendarItems: CalendarItem[] = [];

  function monthBounds(date: Date): [string, string] {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
  }

  function memoCategory(memo: Memo | undefined): string {
    if (!memo) return '提醒';
    if (memo.source === 'blackboard' || memo.categoryId === 'course') return '课程';
    if (memo.categoryId === 'inbox') return '待整理';
    return '生活';
  }

  $: allReminderItems = snapshot.reminders
    .map((reminder): RecentItem => {
      const memo = snapshot.memos.find((item) => item.id === reminder.memoId);
      const title = memo?.title ?? reminder.title;
      return {
        id: reminder.id,
        memoId: memo?.id ?? '',
        title,
        dueAt: reminder.dueAt,
        source: memo?.source ?? 'manual',
        status: reminder.status,
        category: memoCategory(memo),
        searchText: [title, memo?.richText ?? '', memo?.tags?.join(' ') ?? ''].join(' '),
      };
    })
    .sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''));

  $: filteredReminderItems = allReminderItems.filter((item) => {
    const normalizedQuery = query.trim().toLowerCase();
    const matchesQuery = !normalizedQuery || item.title.toLowerCase().includes(normalizedQuery) || (item.searchText ?? '').toLowerCase().includes(normalizedQuery);
    const matchesCategory = categoryFilter === 'all' || item.category === ({ course: '课程', life: '生活', inbox: '待整理' }[categoryFilter] ?? categoryFilter);
    return matchesQuery && matchesCategory;
  });
  $: recentItems = filteredReminderItems.slice(0, 7);
  $: memoItems = snapshot.memos
    .filter((memo) => {
      const normalizedQuery = query.trim().toLowerCase();
      const matchesQuery = !normalizedQuery || [memo.title, memo.richText, memo.tags.join(' ')].join(' ').toLowerCase().includes(normalizedQuery);
      const matchesCategory = categoryFilter === 'all' || memoCategory(memo) === ({ course: '课程', life: '生活', inbox: '待整理' }[categoryFilter] ?? categoryFilter);
      return matchesQuery && matchesCategory;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

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

  function refresh() {
    snapshot = repository.load();
  }

  function navigate(event: CustomEvent<View>) {
    activeView = event.detail;
    query = '';
    categoryFilter = 'all';
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

  function editMemo(memo: Memo) {
    const reminder = snapshot.reminders.find((item) => item.memoId === memo.id);
    editingId = memo.id;
    editingDraft = {
      title: memo.title,
      body: memo.richText,
      categoryId: memo.categoryId,
      tags: memo.tags,
      reminderAt: reminder?.dueAt.slice(0, 16) ?? '',
      recurrenceRule: reminder?.recurrenceRule ?? null,
    };
    showEditor = true;
  }

  function editItem(event: CustomEvent<RecentItem>) {
    const item = event.detail;
    const reminder = snapshot.reminders.find((entry) => entry.id === item.id);
    const memo = item.memoId ? snapshot.memos.find((entry) => entry.id === item.memoId) : undefined;
    if (memo) {
      editMemo(memo);
      return;
    }
    if (!reminder) return;
    editingId = null;
    editingDraft = { standalone: true, title: reminder.title, reminderAt: reminder.dueAt.slice(0, 16), recurrenceRule: reminder.recurrenceRule };
    showEditor = true;
  }

  function saveMemo(event: CustomEvent<MemoDraft>) {
    if (event.detail.standalone) {
      const existingReminder = editingId ? snapshot.reminders.find((item) => item.id === editingId) : undefined;
      repository.saveReminderDraft({ id: existingReminder?.id, title: event.detail.title, dueAt: event.detail.reminderAt, recurrenceRule: event.detail.recurrenceRule, memoId: null });
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
    if (reminder) editItem(new CustomEvent('select', { detail: { id: reminder.id, memoId: reminder.memoId ?? '', title: event.detail.title, dueAt: reminder.dueAt, source: 'manual', status: reminder.status, category: '提醒' } }));
  }

  function handleImport() {
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

  function closeEditorFromBackdrop(event: MouseEvent) {
    if (event.target === event.currentTarget) showEditor = false;
  }

  function closeImporterFromBackdrop(event: MouseEvent) {
    if (event.target === event.currentTarget) showImporter = false;
  }

  onMount(() => {
    let stop: (() => void) | undefined;
    const initialize = async () => {
      if (desktopPersistence) await repository.loadAsync();
      refresh();
      stop = startReminderScheduler(repository, (reminder) => { void notifyReminder(reminder); });
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
  <Sidebar activeView={activeView} on:navigate={navigate} on:importBlackboard={handleImport} on:exportData={exportData} on:exportPlainText={exportPlainText} />

  <main class="workspace">
    {#if activeView === 'overview'}
      <header class="workspace-header">
        <div>
          <h1 class="workspace-title">今天要做什么？</h1>
          <p class="workspace-subtitle">让每个提醒都有一个清晰的下一步。</p>
        </div>
        <div class="header-tools">
          <input class="search-box" aria-label="搜索备忘录" placeholder="搜索备忘录…" bind:value={query} />
          <SelectMenu label="筛选分类" bind:value={categoryFilter} options={categoryOptions} />
          <button class="secondary-action" type="button" on:click={openNewReminder}>＋ 新建提醒</button>
          <button class="primary-button" type="button" on:click={openNewMemo}>＋ 新建备忘录</button>
        </div>
      </header>

      <section class="dashboard">
        <RecentItems items={recentItems} {query} on:select={editItem} on:status={updateStatus} />
        <MonthCalendar month={currentMonth} items={calendarItems} on:monthChange={(event) => (currentMonth = event.detail)} on:select={selectCalendarItem} />
      </section>
    {:else if activeView === 'memos'}
      <header class="workspace-header page-header">
        <div>
          <p class="workspace-kicker">内容库</p>
          <h1 class="workspace-title">备忘录</h1>
          <p class="workspace-subtitle">整理想法、清单和课程资料。</p>
        </div>
        <div class="header-tools">
          <input class="search-box" aria-label="搜索备忘录" placeholder="搜索备忘录…" bind:value={query} />
          <SelectMenu label="筛选分类" bind:value={categoryFilter} options={categoryOptions} />
          <button class="primary-button" type="button" on:click={openNewMemo}>＋ 新建备忘录</button>
        </div>
      </header>
      <MemoList items={memoItems} {query} on:select={(event) => editMemo(event.detail)} />
    {:else}
      <header class="workspace-header page-header">
        <div>
          <p class="workspace-kicker">时间安排</p>
          <h1 class="workspace-title">提醒</h1>
          <p class="workspace-subtitle">查看所有待处理和已完成的提醒。</p>
        </div>
        <div class="header-tools">
          <input class="search-box" aria-label="搜索提醒" placeholder="搜索提醒…" bind:value={query} />
          <SelectMenu label="筛选分类" bind:value={categoryFilter} options={categoryOptions} />
          <button class="primary-button" type="button" on:click={openNewReminder}>＋ 新建提醒</button>
        </div>
      </header>
      <section class="single-panel">
        <RecentItems items={filteredReminderItems} {query} title="全部提醒" eyebrow="提醒" emptyMessage="还没有提醒，先安排一件要做的事吧。" on:select={editItem} on:status={updateStatus} />
      </section>
    {/if}
  </main>
</div>

{#if showEditor}
  <div class="overlay" role="presentation" on:click={closeEditorFromBackdrop}>
    <div class="modal" role="dialog" aria-modal="true" aria-label="编辑备忘录">
      <ReminderEditor initial={editingDraft} on:save={saveMemo} on:cancel={() => (showEditor = false)} />
    </div>
  </div>
{/if}

{#if showImporter}
  <div class="overlay" role="presentation" on:click={closeImporterFromBackdrop}>
    <div class="modal" role="dialog" aria-modal="true" aria-label="导入 Blackboard">
      <BlackboardImportDialog on:close={() => (showImporter = false)} on:confirm={confirmImport} />
    </div>
  </div>
{/if}

<style>
  .page-header { margin-bottom:28px; }
  .single-panel { max-width:820px; }
</style>