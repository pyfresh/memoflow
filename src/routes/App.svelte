<script lang="ts">
  import { onMount } from 'svelte';
  import BlackboardImportDialog from '../components/BlackboardImportDialog.svelte';
  import CourseScheduleImportDialog from '../components/CourseScheduleImportDialog.svelte';
  import CountdownPage from '../components/CountdownPage.svelte';
  import MemoList from '../components/MemoList.svelte';
  import MonthCalendar from '../components/MonthCalendar.svelte';
  import NotificationSettings from '../components/NotificationSettings.svelte';
  import RecentItems from '../components/RecentItems.svelte';
  import ReminderEditor from '../components/ReminderEditor.svelte';
  import Sidebar from '../components/Sidebar.svelte';
  import WeeklySchedule from '../components/WeeklySchedule.svelte';
  import type { View } from '$lib/domain/navigation';
  import type { BlackboardCapturePayload, CalendarItem, Countdown, Memo, NotificationSettings as NotificationSettingsType, RecentItem, ScheduleCandidate } from '$lib/domain/types';
  import type { MemoDraft } from '$lib/data/repository';
  import { createBrowserRepository, type AppSnapshot } from '$lib/data/repository';
  import { getReminderOccurrences } from '$lib/domain/reminders';
  import { startOfWeek } from '$lib/domain/schedule';
  import { startReminderScheduler } from '$lib/reminders/scheduler';
  import { notifyCountdown, notifyReminder } from '$lib/notifications';
  import { sendPushPlusReminder } from '$lib/notifications/pushplus';
  import { createDesktopPersistenceDriver } from '$lib/data/desktop';
  import { classifyBlackboardSource, normalizeCourseCode } from '$lib/import/normalize';

  const desktopPersistence = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? createDesktopPersistenceDriver() : undefined;
  const repository = createBrowserRepository(desktopPersistence);
  let snapshot: AppSnapshot = repository.load();
  let currentMonth = new Date();
  let currentWeek = startOfWeek(new Date());
  let activeView: View = 'overview';
  let query = '';
  let showEditor = false;
  let showImporter = false;
  let showScheduleImporter = false;
  let showNotificationSettings = false;
  let syncMessage = '';
  let scheduleMessage = '';
  let editingDraft: Partial<MemoDraft> = {};
  let editingId: string | null = null;
  let editingReminderId: string | null = null;
  let notificationSettings: NotificationSettingsType = repository.getNotificationSettings();
  const countdownNotificationsInFlight = new Set<string>();

  let allReminderItems: RecentItem[] = [];
  let filteredReminderItems: RecentItem[] = [];
  let recentItems: RecentItem[] = [];
  let memoItems: Memo[] = [];
  let calendarItems: CalendarItem[] = buildCalendarItems(snapshot, currentMonth);
  let calendarVersion = 0;

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

  function blackboardRecentTags(memo: Memo | undefined): string[] {
    if (!memo || memo.source !== 'blackboard') return [];

    const item = snapshot.blackboardItems.find((candidate) =>
      (memo.externalItemId && candidate.externalId === memo.externalItemId)
      || (memo.sourceUrl && candidate.sourceUrl === memo.sourceUrl),
    );
    const typeTags = new Set(['assignment', 'project', 'exam', 'event', 'other']);
    const itemType = item?.itemType ?? memo.tags.find((tag) => typeTags.has(tag.toLowerCase()));
    const courseCode = normalizeCourseCode(item?.courseName, item?.courseCode)
      ?? memo.tags.find((tag) => /^[A-Za-z]{2,}\s*\d{3,}[A-Za-z0-9-]*$/.test(tag));
    return [...new Set([itemType, courseCode].filter((tag): tag is string => Boolean(tag)))];
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
        tags: blackboardRecentTags(memo),
        searchText: [title, memo?.richText ?? '', memo?.tags?.join(' ') ?? ''].join(' '),
      };
    })
    .sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''));

  $: filteredReminderItems = allReminderItems.filter((item) => {
    const normalizedQuery = query.trim().toLowerCase();
    const matchesQuery = !normalizedQuery || item.title.toLowerCase().includes(normalizedQuery) || (item.searchText ?? '').toLowerCase().includes(normalizedQuery);
    return matchesQuery;
  });
  $: recentItems = filteredReminderItems.filter((item) => item.status !== 'completed').slice(0, 7);
  $: memoItems = snapshot.memos
    .filter((memo) => {
      const normalizedQuery = query.trim().toLowerCase();
      const matchesQuery = !normalizedQuery || [memo.title, memo.richText, memo.tags.join(' ')].join(' ').toLowerCase().includes(normalizedQuery);
      return matchesQuery;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  function buildCalendarItems(source: AppSnapshot, month: Date): CalendarItem[] {
    const [rangeStart, rangeEnd] = monthBounds(month);
    return source.reminders.flatMap((reminder): CalendarItem[] => {
      const memo = source.memos.find((item) => item.id === reminder.memoId);
      return getReminderOccurrences(reminder, rangeStart, rangeEnd).map((occurrence) => ({
        id: reminder.id,
        date: occurrence.slice(0, 10),
        title: memo?.title ?? reminder.title,
        kind: memo?.source === 'blackboard' ? 'course' : 'reminder',
        time: occurrence.slice(11, 16),
        status: reminder.status,
      }));
    });
  }

  function refresh() {
    snapshot = repository.load();
    notificationSettings = repository.getNotificationSettings();
    calendarItems = buildCalendarItems(snapshot, currentMonth);
  }

  function changeCalendarMonth(event: CustomEvent<Date>) {
    currentMonth = event.detail;
    calendarItems = buildCalendarItems(snapshot, currentMonth);
  }

  function navigate(event: CustomEvent<View>) {
    activeView = event.detail;
    query = '';
  }

  function openNewMemo() {
    editingId = null;
    editingReminderId = null;
    editingDraft = {};
    showEditor = true;
  }

  function openNewReminder() {
    editingId = null;
    editingReminderId = null;
    editingDraft = { standalone: true };
    showEditor = true;
  }

  function editMemo(memo: Memo) {
    const reminder = snapshot.reminders.find((item) => item.memoId === memo.id);
    editingId = memo.id;
    editingReminderId = reminder?.id ?? null;
    editingDraft = {
      title: memo.title,
      body: memo.richText,
      sourceUrl: memo.sourceUrl,
      sourceKind: memo.sourceKind,
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
    editingReminderId = reminder.id;
    editingDraft = { standalone: true, title: reminder.title, reminderAt: reminder.dueAt.slice(0, 16), recurrenceRule: reminder.recurrenceRule };
    showEditor = true;
  }

  function saveMemo(event: CustomEvent<MemoDraft>) {
    if (event.detail.standalone) {
      const existingReminder = editingReminderId ? snapshot.reminders.find((item) => item.id === editingReminderId) : undefined;
      repository.saveReminderDraft({ id: existingReminder?.id, title: event.detail.title, dueAt: event.detail.reminderAt, recurrenceRule: event.detail.recurrenceRule, memoId: null });
    } else {
      repository.saveMemoDraft({ ...event.detail, id: editingId ?? undefined });
    }
    showEditor = false;
    refresh();
    void repository.flush();
  }

  function completeEditorItem(event: CustomEvent<{ memoId: string | null; reminderId: string | null }>) {
    if (!event.detail.reminderId) return;
    repository.setReminderStatus(event.detail.reminderId, 'completed');
    showEditor = false;
    refresh();
    calendarItems = calendarItems.map((item) => item.id === event.detail.reminderId ? { ...item, status: 'completed' } : item);
    calendarVersion += 1;
    void repository.flush();
  }

  function deleteEditorItem(event: CustomEvent<{ memoId: string | null; reminderId: string | null }>) {
    if (event.detail.memoId) repository.deleteMemo(event.detail.memoId);
    else if (event.detail.reminderId) repository.deleteReminder(event.detail.reminderId);
    else return;
    showEditor = false;
    refresh();
    void repository.flush();
  }

  function updateStatus(event: CustomEvent<{ item: RecentItem; status: 'completed' | 'ignored' }>) {
    repository.setReminderStatus(event.detail.item.id, event.detail.status);
    refresh();
    calendarItems = calendarItems.map((item) => item.id === event.detail.item.id ? { ...item, status: event.detail.status } : item);
    calendarVersion += 1;
    void repository.flush();
  }

  function selectCalendarItem(event: CustomEvent<CalendarItem>) {
    const reminder = snapshot.reminders.find((item) => item.id === event.detail.id);
    if (reminder) editItem(new CustomEvent('select', { detail: { id: reminder.id, memoId: reminder.memoId ?? '', title: event.detail.title, dueAt: reminder.dueAt, source: 'manual', status: reminder.status, category: '提醒' } }));
  }

  function handleImport() {
    showImporter = true;
  }

  function handleScheduleImport() {
    showScheduleImporter = true;
  }

  function handleNotificationSettings() {
    showNotificationSettings = true;
  }

  function saveNotificationSettings(event: CustomEvent<NotificationSettingsType>) {
    notificationSettings = event.detail;
    repository.saveNotificationSettings(event.detail);
    void repository.flush();
  }

  function createCountdown(event: CustomEvent<{ name: string; totalSeconds: number }>) {
    repository.createCountdown(event.detail);
    refresh();
    void repository.flush();
  }

  function changeCountdown(event: CustomEvent<{ id: string; status: 'running' | 'paused' }>) {
    repository.updateCountdown(event.detail.id, { status: event.detail.status });
    refresh();
    void repository.flush();
  }

  function resetCountdown(event: CustomEvent<string>) {
    repository.resetCountdown(event.detail);
    refresh();
    void repository.flush();
  }

  function deleteCountdown(event: CustomEvent<string>) {
    repository.deleteCountdown(event.detail);
    refresh();
    void repository.flush();
  }

  async function notifyCompletedCountdown(countdown: Countdown) {
    if (countdownNotificationsInFlight.has(countdown.id)) return;
    countdownNotificationsInFlight.add(countdown.id);
    try {
      const result = await notifyCountdown(countdown, notificationSettings);
      const sentAt = new Date().toISOString();
      for (const channel of ['native', 'pushplus'] as const) {
        const outcome = result[channel];
        if (!outcome) continue;
        if (outcome.sent) repository.markCountdownNotificationChannelSent(countdown.id, channel, sentAt);
        else if (outcome.error) repository.markCountdownNotificationChannelFailed(countdown.id, channel, outcome.error);
      }
      refresh();
      await repository.flush();
    } finally {
      countdownNotificationsInFlight.delete(countdown.id);
    }
  }

  function syncCompletedCountdowns() {
    for (const countdown of repository.listCountdowns()) {
      if (countdown.status === 'completed' && !countdown.notificationSentAt) void notifyCompletedCountdown(countdown);
    }
  }

  function tickCountdowns(lastTickAt: { value: number }) {
    const now = Date.now();
    const elapsedSeconds = Math.max(1, Math.floor((now - lastTickAt.value) / 1000));
    lastTickAt.value = now;
    repository.advanceCountdowns(elapsedSeconds);
    refresh();
    syncCompletedCountdowns();
  }

  async function testPushPlus(token: string) {
    const now = new Date().toISOString();
    await sendPushPlusReminder({
      id: 'test-notification', memoId: null, title: 'MemoFlow 测试提醒', dueAt: now,
      recurrenceRule: null, status: 'pending', notificationSentAt: null,
      createdAt: now, updatedAt: now,
    }, token, undefined, 'test');
  }

  function confirmImport(event: CustomEvent<BlackboardCapturePayload>) {
    const itemResult = repository.importBlackboardItems(event.detail.items);
    const unresolvedCount = event.detail.items.filter((item) => (item.sourceKind ?? classifyBlackboardSource(item.sourceUrl)) !== 'assignment').length;
    const parts = [`新增 ${itemResult.newCount}`, `更新 ${itemResult.updatedCount}`, `已存在 ${itemResult.existingCount}`];
    if (itemResult.errorCount) parts.push(`失败 ${itemResult.errorCount}`);
    syncMessage = `Blackboard 作业导入完成：${parts.join('，')}。${unresolvedCount ? ` ${unresolvedCount} 个事项尚未定位到作业提交页。` : '作业链接已完成校验。'}`;
    showImporter = false;
    refresh();
    void repository.flush();
  }

  function confirmScheduleImport(event: CustomEvent<{ schedules: ScheduleCandidate[] }>) {
    const result = repository.importCourseSchedules(event.detail.schedules, 'archive');
    scheduleMessage = `课表导入完成：新增 ${result.newCount}，更新 ${result.updatedCount}，已存在 ${result.existingCount}。`;
    showScheduleImporter = false;
    refresh();
    void repository.flush();
  }

  function closeEditorFromBackdrop(event: MouseEvent) {
    if (event.target === event.currentTarget) showEditor = false;
  }

  function closeImporterFromBackdrop(event: MouseEvent) {
    if (event.target !== event.currentTarget) return;
    showImporter = false;
    showScheduleImporter = false;
  }

  onMount(() => {
    let stop: (() => void) | undefined;
    const lastCountdownTickAt = { value: Date.now() };
    const countdownTimer = window.setInterval(() => tickCountdowns(lastCountdownTickAt), 1000);
    const initialize = async () => {
      if (desktopPersistence) await repository.loadAsync();
      refresh();
      stop = startReminderScheduler(repository, (reminder) => {
        const memo = snapshot.memos.find((item) => item.id === reminder.memoId);
        const item = memo?.source === 'blackboard'
          ? snapshot.blackboardItems.find((candidate) => candidate.externalId === memo.externalItemId || candidate.sourceUrl === memo.sourceUrl)
          : undefined;
        return notifyReminder(reminder, notificationSettings, { courseCode: item?.courseCode ?? undefined, itemType: item?.itemType ?? undefined });
      });
    };
    void initialize();
    return () => { stop?.(); window.clearInterval(countdownTimer); };
  });
</script>

<svelte:head>
  <title>MemoFlow · 备忘录与提醒</title>
  <meta name="description" content="个人备忘录、月历和课程提醒" />
</svelte:head>

<svelte:window on:keydown={(event) => event.key === 'n' && (event.ctrlKey || event.metaKey) && openNewMemo()} />

<div class="app-shell">
  <h1 class="sr-only">MemoFlow</h1>
  <Sidebar activeView={activeView} on:navigate={navigate} on:importBlackboard={handleImport} on:openNotificationSettings={handleNotificationSettings} />

  <main class="workspace">
    {#if syncMessage}<p class="sync-feedback" role="status" aria-live="polite">{syncMessage}</p>{/if}
    {#if scheduleMessage}<p class="sync-feedback" role="status" aria-live="polite">{scheduleMessage}</p>{/if}
    {#if activeView === 'overview'}
      <header class="workspace-header">
        <div>
          <h1 class="workspace-title">今天要做什么？</h1>
          <p class="workspace-subtitle">让每个提醒都有一个清晰的下一步。</p>
        </div>
        <div class="header-tools">
          <input class="search-box" aria-label="搜索备忘录" placeholder="搜索备忘录…" bind:value={query} />
          <button class="secondary-action" type="button" on:click={openNewReminder}>＋ 新建提醒</button>
          <button class="primary-button" type="button" on:click={openNewMemo}>＋ 新建备忘录</button>
        </div>
      </header>

      <section class="dashboard">
        <RecentItems items={recentItems} {query} on:select={editItem} on:status={updateStatus} />
        {#key calendarVersion}
          <MonthCalendar month={currentMonth} items={calendarItems} on:monthChange={changeCalendarMonth} on:select={selectCalendarItem} />
        {/key}
      </section>
    {:else if activeView === 'schedule'}
      <WeeklySchedule entries={snapshot.courseSchedules ?? []} weekStart={currentWeek} on:weekChange={(event) => (currentWeek = event.detail)} on:importZip={handleScheduleImport} />
    {:else if activeView === 'countdown'}
      <CountdownPage countdowns={snapshot.countdowns ?? []} on:create={createCountdown} on:change={changeCountdown} on:reset={resetCountdown} on:delete={deleteCountdown} />
    {:else if activeView === 'memos'}
      <header class="workspace-header page-header">
        <div>
          <p class="workspace-kicker">内容库</p>
          <h1 class="workspace-title">备忘录</h1>
          <p class="workspace-subtitle">整理想法、清单和课程资料。</p>
        </div>
        <div class="header-tools">
          <input class="search-box" aria-label="搜索备忘录" placeholder="搜索备忘录…" bind:value={query} />
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
      <ReminderEditor initial={editingDraft} existingMemoId={editingId} existingReminderId={editingReminderId} on:save={saveMemo} on:complete={completeEditorItem} on:delete={deleteEditorItem} on:cancel={() => (showEditor = false)} />
    </div>
  </div>
{/if}

{#if showImporter}
  <div class="overlay" role="presentation" on:click={closeImporterFromBackdrop}>
    <div class="modal" role="dialog" aria-modal="true" aria-label="从 Blackboard 导入作业">
      <BlackboardImportDialog on:close={() => (showImporter = false)} on:confirm={confirmImport} />
    </div>
  </div>
{/if}

{#if showScheduleImporter}
  <div class="overlay" role="presentation" on:click={closeImporterFromBackdrop}>
    <div class="modal" role="dialog" aria-modal="true" aria-label="导入课表 ZIP">
      <CourseScheduleImportDialog on:close={() => (showScheduleImporter = false)} on:confirm={confirmScheduleImport} />
    </div>
  </div>
{/if}

{#if showNotificationSettings}
  <div class="overlay" role="presentation" on:click={(event) => event.target === event.currentTarget && (showNotificationSettings = false)}>
    <div class="modal" role="dialog" aria-modal="true" aria-label="通知设置">
      <NotificationSettings settings={notificationSettings} on:save={saveNotificationSettings} onCancel={() => (showNotificationSettings = false)} onTest={testPushPlus} />
    </div>
  </div>
{/if}

<style>
  .page-header { margin-bottom:28px; }
  .single-panel { max-width:820px; }
  .sync-feedback { margin:0 0 16px; border:1px solid var(--accent-soft); border-radius:8px; padding:10px 12px; background:var(--surface-tint); color:var(--accent-strong); font-size:.78rem; font-weight:650; }
</style>
