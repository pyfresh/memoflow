<script lang="ts">
  import { onMount } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import { invoke } from '@tauri-apps/api/core';
  import { createEventDispatcher } from 'svelte';
  import type { BlackboardCapturePayload, ImportCandidate, ScheduleCandidate } from '$lib/domain/types';
  import { normalizeExternalItem } from '$lib/import/normalize';
  import { parseIcalFeed } from '$lib/import/ical';

  type Stage = 'start' | 'login' | 'preview' | 'done';
  type SourceMode = 'page' | 'ical';
  export let onConfirm: (payload: BlackboardCapturePayload) => void = () => {};

  const dispatch = createEventDispatcher<{ close: void; confirm: BlackboardCapturePayload }>();
  let stage: Stage = 'start';
  let sourceMode: SourceMode = 'page';
  let icalUrl = '';
  let candidates: ImportCandidate[] = [];
  let schedules: ScheduleCandidate[] = [];
  let selected = new Set<string>();
  let errorMessage = '';
  let readState: 'idle' | 'reading' | 'success' | 'empty' | 'error' = 'idle';
  let statusMessage = '';
  let skippedCount = 0;
  let readTimer: ReturnType<typeof setTimeout> | undefined;

  const sampleItems: ImportCandidate[] = [
    {
      externalId: 'demo-math-project-1',
      courseName: 'MATH 101',
      courseCode: 'MATH101',
      title: 'Project 1',
      itemType: 'project',
      dueAt: '2026-10-08T23:59:00+08:00',
      sourceUrl: 'https://bb.cuhk.edu.cn/',
    },
    {
      externalId: 'demo-csc-assignment-2',
      courseName: 'CSC 201',
      courseCode: 'CSC201',
      title: 'Assignment 2',
      itemType: 'assignment',
      dueAt: '2026-10-12T18:00:00+08:00',
      sourceUrl: 'https://bb.cuhk.edu.cn/',
    },
  ];

  function isTauri() {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  }

  onMount(() => {
    if (!isTauri()) return;
    let stopCapture: (() => void) | undefined;
    let stopError: (() => void) | undefined;
    listen<ImportCandidate[] | BlackboardCapturePayload>('blackboard-capture', (event) => {
      try {
        if (readTimer) clearTimeout(readTimer);
        const payload = Array.isArray(event.payload) ? { items: event.payload, schedules: [] } : event.payload;
        candidates = payload.items.map((item) => normalizeExternalItem(item));
        schedules = payload.schedules;
        skippedCount = 0;
        if (candidates.length === 0 && schedules.length === 0) {
          readState = 'empty';
          statusMessage = '读取完成，但当前页面没有可导入的作业或课程时段。请确认日历中的课程日历已勾选，并再次点击读取。';
          errorMessage = '';
          return;
        }
        selected = new Set(candidates.map((item) => item.externalId ?? item.sourceUrl));
        stage = 'preview';
        readState = 'success';
        statusMessage = `读取成功：发现 ${candidates.length} 个事项和 ${schedules.length} 节课程。`;
        errorMessage = '';
      } catch {
        readState = 'error';
        statusMessage = '读取结果无法解析，请确认 Blackboard 页面已完成加载后重试。';
        errorMessage = '读取 Blackboard 数据失败，请确认当前页面是总日历或课程日历。';
      }
    }).then((unlisten) => {
      stopCapture = unlisten;
    });
    listen<string>('blackboard-capture-error', (event) => {
      if (readTimer) clearTimeout(readTimer);
      readState = 'error';
      statusMessage = `读取失败：${event.payload}`;
      errorMessage = '';
    }).then((unlisten) => {
      stopError = unlisten;
    });
    return () => {
      stopCapture?.();
      stopError?.();
      if (readTimer) clearTimeout(readTimer);
    };
  });

  async function startLogin() {
    sourceMode = 'page';
    stage = 'login';
    errorMessage = '';
    readState = 'idle';
    statusMessage = '请在 Blackboard 窗口中登录，并打开 Calendar。';
    if (!isTauri()) {
      errorMessage = 'Blackboard 导入只能在 MemoFlow 桌面版中运行。';
      return;
    }
    try {
      await invoke('open_blackboard_window');
    } catch (error) {
      errorMessage = String(error);
    }
  }

  function startIcal() {
    sourceMode = 'ical';
    stage = 'login';
    readState = 'idle';
    statusMessage = '粘贴 Blackboard 的 Get External Calendar Link 后读取。链接只用于本次导入，不会保存。';
    errorMessage = '';
    candidates = [];
    schedules = [];
    skippedCount = 0;
  }

  function validateIcalUrl(value: string): string | null {
    if (!value.trim()) return '请粘贴 Blackboard 的 iCal 链接。';
    try {
      const url = new URL(value.trim());
      const path = url.pathname.toLowerCase();
      if (url.protocol !== 'https:' || url.hostname !== 'bb.cuhk.edu.cn' || (!path.endsWith('.ics') && !path.includes('/calendarfeed/'))) {
        return '只支持 bb.cuhk.edu.cn 提供的 HTTPS iCalendar 链接。';
      }
      if (value.trim().length > 2048) return 'iCal 链接过长，请重新复制 Blackboard 链接。';
    } catch {
      return 'iCal 链接格式无效，请重新复制 Blackboard 链接。';
    }
    return null;
  }

  async function readIcal() {
    const url = icalUrl.trim();
    const validationError = validateIcalUrl(url);
    if (validationError) {
      readState = 'error';
      statusMessage = '';
      errorMessage = validationError;
      return;
    }
    if (!isTauri()) {
      readState = 'error';
      statusMessage = '';
      errorMessage = 'iCal 链接导入只能在 MemoFlow 桌面版中运行。';
      return;
    }
    readState = 'reading';
    statusMessage = '正在读取 iCal 日历，请稍候…';
    errorMessage = '';
    try {
      const feed = await invoke<string>('fetch_blackboard_ical', { url });
      statusMessage = '读取完成，正在分析日历内容…';
      const result = parseIcalFeed(feed, url);
      candidates = result.items;
      schedules = result.schedules;
      skippedCount = result.skippedCount;
      selected = new Set(candidates.map((item) => item.externalId ?? item.sourceUrl));
      stage = 'preview';
      readState = candidates.length || schedules.length ? 'success' : 'empty';
      statusMessage = candidates.length || schedules.length
        ? `读取成功：发现 ${candidates.length} 个事项和 ${schedules.length} 节课程${skippedCount ? `，跳过 ${skippedCount} 条` : ''}。`
        : '读取完成，但没有可导入的事项或课程时段。请确认 Blackboard 日历已勾选内容。';
    } catch (error) {
      readState = 'error';
      statusMessage = '本次读取未生效。';
      errorMessage = String(error).replace(/^Error:\s*/i, '') || '无法读取 Blackboard iCal 日历，请检查链接是否过期。';
    }
  }

  async function readCalendar() {
    if (!isTauri()) {
      errorMessage = 'Blackboard 导入只能在 MemoFlow 桌面版中运行。';
      return;
    }
    readState = 'reading';
    statusMessage = '正在读取当前 Blackboard 页面，请稍候…';
    errorMessage = '';
    try {
      await invoke('capture_blackboard_calendar');
      if (readState === 'reading') {
        statusMessage = '已发送读取请求，正在分析日历内容…';
        if (readTimer) clearTimeout(readTimer);
        readTimer = setTimeout(() => {
          if (readState !== 'reading') return;
          readState = 'error';
          statusMessage = '等待 Blackboard 返回结果超时。请确认当前窗口仍停留在 Calendar 页面后重试。';
        }, 10000);
      }
    } catch (error) {
      if (readTimer) clearTimeout(readTimer);
      readState = 'error';
      statusMessage = '读取请求未能发送。';
      errorMessage = String(error);
    }
  }

  async function closeImporter() {
    if (isTauri()) {
      try { await invoke('clear_blackboard_session'); } catch { }
    }
    dispatch('close');
  }

  function toggle(candidate: ImportCandidate) {
    const key = candidate.externalId ?? candidate.sourceUrl;
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selected = next;
  }

  function confirmImport() {
    const payload = { items: candidates.filter((item) => selected.has(item.externalId ?? item.sourceUrl)), schedules };
    onConfirm(payload);
    dispatch('confirm', payload);
    stage = 'done';
  }
</script>

<div class="import-dialog">
  <div class="modal-header">
    <div>
      <p class="eyebrow">课程同步</p>
      <h2>导入 Blackboard</h2>
    </div>
    <button class="close-button" type="button" aria-label="关闭" on:click={closeImporter}>×</button>
  </div>

  {#if errorMessage}
    <div class="error-message" role="alert">{errorMessage}</div>
  {/if}

  {#if stage === 'start'}
    <div class="step-card">
      <span class="step-number">1</span>
      <div><b>在应用内登录学校平台</b><p>点击后打开 Blackboard 登录窗口，密码只由学校页面处理。</p></div>
    </div>
    <button class="primary-button full" type="button" on:click={startLogin}>打开 Blackboard 登录</button>
    <button class="secondary-button full mode-button" type="button" on:click={startIcal}>通过 iCal 链接导入</button>
  {:else if stage === 'login'}
    {#if sourceMode === 'page'}
      <div class="step-card">
        <span class="step-number">2</span>
        <div><b>登录后打开总日历</b><p>完成 SSO 登录，并打开课程总日历/活动页面，然后回到这里继续。</p></div>
      </div>
    {:else}
      <div class="step-card">
        <span class="step-number">2</span>
        <div><b>粘贴 Blackboard 日历链接</b><p>在 Blackboard Calendar 选择 Get External Calendar Link，复制私有 .ics 地址。</p></div>
      </div>
      <label class="url-field">
        <span>Blackboard iCal 链接</span>
        <input aria-label="Blackboard iCal 链接" type="url" placeholder="https://bb.cuhk.edu.cn/.../learn.ics" bind:value={icalUrl} autocomplete="off" spellcheck="false" />
      </label>
    {/if}
    {#if statusMessage}
      <div class:pending={readState === 'reading'} class:success={readState === 'success'} class:empty={readState === 'empty'} class:status-error={readState === 'error'} class="read-status" role="status" aria-live="polite">
        <span class="status-dot" aria-hidden="true"></span>
        <span>{statusMessage}</span>
      </div>
    {/if}
    <div class="dialog-actions">
      <button class="secondary-button" type="button" on:click={() => (stage = 'start')}>返回</button>
      {#if sourceMode === 'ical'}
        <button class="primary-button" type="button" disabled={readState === 'reading'} on:click={readIcal}>{readState === 'reading' ? '读取中…' : '读取 iCal'}</button>
      {:else}
        <button class="primary-button" type="button" disabled={readState === 'reading'} on:click={readCalendar}>{readState === 'reading' ? '读取中…' : '读取总日历'}</button>
      {/if}
    </div>
  {:else if stage === 'preview'}
    <div class="preview-summary"><b>导入预览</b><span>{selected.size} 项目 · {schedules.length} 节课程{skippedCount ? ` · 跳过 ${skippedCount} 条` : ''}</span></div>
    {#if statusMessage}
      <div class:pending={readState === 'reading'} class:success={readState === 'success'} class:empty={readState === 'empty'} class:status-error={readState === 'error'} class="read-status" role="status" aria-live="polite">
        <span class="status-dot" aria-hidden="true"></span>
        <span>{statusMessage}</span>
      </div>
    {/if}
    <div class="candidate-list">
      {#each candidates as candidate}
        {@const key = candidate.externalId ?? candidate.sourceUrl}
        <label class="candidate">
          <input type="checkbox" checked={selected.has(key)} on:change={() => toggle(candidate)} />
          <span class="candidate-main"><b>{candidate.title}</b><small>{candidate.courseName} · {candidate.dueAt?.replace('T', ' ').replace('+08:00', '')}</small></span>
          <span class="tag course">{candidate.itemType}</span>
        </label>
      {/each}
    </div>
    <div class="dialog-actions">
      <button class="secondary-button" type="button" on:click={() => (stage = 'login')}>返回</button>
      <button class="primary-button" type="button" disabled={selected.size === 0 && schedules.length === 0} on:click={confirmImport}>确认导入</button>
    </div>
  {:else}
    <div class="success-state"><span class="success-icon">✓</span><h3>导入完成</h3><p>项目已写入备忘录和提醒，课程时段已更新到周课表。</p><button class="primary-button" type="button" on:click={closeImporter}>返回日历</button></div>
  {/if}
</div>

<style>
  .eyebrow { margin:0 0 5px; color:var(--ink-muted); font-size:.75rem; letter-spacing:.08em; text-transform:uppercase; }
  h2 { margin:0; font-size:1.45rem; letter-spacing:-.035em; }
  .error-message { margin-bottom:14px; border-radius:8px; padding:10px 12px; background:#fff0e9; color:var(--danger); font-size:.8rem; }
  .read-status { display:flex; gap:8px; align-items:flex-start; margin:12px 0 0; border:1px solid var(--line); border-radius:10px; padding:10px 12px; color:var(--ink-soft); font-size:.78rem; line-height:1.45; background:var(--surface-subtle); }
  .read-status.pending { border-color:#f0d3a2; background:#fff8e9; color:#93631a; }
  .read-status.success { border-color:#b9dfc8; background:#effaf3; color:#28754a; }
  .read-status.empty { border-color:#f0d3a2; background:#fff8e9; color:#93631a; }
  .read-status.status-error { border-color:#f0c0b7; background:#fff0ed; color:var(--danger); }
  .status-dot { width:7px; height:7px; flex:none; margin-top:5px; border-radius:50%; background:var(--ink-muted); }
  .read-status.pending .status-dot { background:#d99427; animation:pulse 1.1s ease-in-out infinite; }
  .read-status.success .status-dot { background:var(--success); }
  .read-status.empty .status-dot { background:#d99427; }
  .read-status.status-error .status-dot { background:var(--danger); }
  @keyframes pulse { 0%,100% { opacity:.4; } 50% { opacity:1; } }
  .step-card { display:flex; gap:13px; align-items:flex-start; margin-bottom:18px; border:1px solid var(--line); border-radius:13px; padding:16px; background:var(--surface-subtle); }
  .step-number { display:grid; place-items:center; width:26px; height:26px; flex:none; border-radius:7px; background:var(--accent-soft); color:var(--accent); font-weight:800; }
  .step-card b { display:block; margin-top:2px; }
  .step-card p { margin:7px 0 0; color:var(--ink-soft); font-size:.82rem; line-height:1.55; }
  .full { width:100%; }
  .mode-button { margin-top:10px; }
  .url-field { display:flex; flex-direction:column; gap:7px; margin:0 0 14px; color:var(--ink-soft); font-size:.78rem; font-weight:700; }
  .url-field input { width:100%; box-sizing:border-box; border:1px solid var(--line); border-radius:9px; padding:11px 12px; background:var(--surface); color:var(--ink); font:inherit; font-weight:500; }
  .url-field input:focus { outline:2px solid var(--accent-soft); border-color:var(--accent); }
  .dialog-actions { display:flex; justify-content:flex-end; gap:9px; margin-top:20px; }
  .primary-button, .secondary-button { border-radius:10px; padding:10px 14px; font-weight:700; }
  .secondary-button { border:1px solid var(--line); background:var(--surface); color:var(--ink-soft); }
  .secondary-button:hover { border-color:var(--accent); color:var(--accent); }
  .primary-button:disabled { cursor:not-allowed; opacity:.45; }
  .preview-summary { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; color:var(--ink-soft); font-size:.84rem; }
  .preview-summary span { color:var(--accent); font-weight:700; }
  .candidate-list { display:flex; flex-direction:column; gap:7px; max-height:310px; overflow:auto; }
  .candidate { display:flex; align-items:center; gap:11px; border:1px solid var(--line); border-radius:8px; padding:11px; cursor:pointer; }
  .candidate:hover { border-color:var(--line-strong); background:var(--surface-tint); }
  .candidate input { accent-color:var(--accent); }
  .candidate-main { display:flex; flex:1; flex-direction:column; gap:4px; min-width:0; }
  .candidate-main b { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .candidate-main small { color:var(--ink-muted); }
  .success-state { padding:25px 10px 8px; text-align:center; }
  .success-icon { display:grid; place-items:center; width:48px; height:48px; margin:0 auto 14px; border-radius:8px; background:#edf7f1; color:var(--success); font-size:1.5rem; font-weight:800; }
  .success-state h3 { margin:0; }
  .success-state p { margin:8px 0 19px; color:var(--ink-soft); }
</style>

