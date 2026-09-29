<script lang="ts">
  import { onMount } from 'svelte';
  import { listen } from '@tauri-apps/api/event';
  import { invoke } from '@tauri-apps/api/core';
  import { createEventDispatcher } from 'svelte';
  import type { BlackboardCapturePayload, ImportCandidate, ScheduleCandidate } from '$lib/domain/types';
  import { normalizeExternalItem } from '$lib/import/normalize';

  type Stage = 'start' | 'login' | 'preview' | 'done';
  export let onConfirm: (payload: BlackboardCapturePayload) => void = () => {};

  const dispatch = createEventDispatcher<{ close: void; confirm: BlackboardCapturePayload }>();
  let stage: Stage = 'start';
  let candidates: ImportCandidate[] = [];
  let schedules: ScheduleCandidate[] = [];
  let selected = new Set<string>();
  let errorMessage = '';

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
    let stop: (() => void) | undefined;
    listen<ImportCandidate[] | BlackboardCapturePayload>('blackboard-capture', (event) => {
      try {
        const payload = Array.isArray(event.payload) ? { items: event.payload, schedules: [] } : event.payload;
        candidates = payload.items.map((item) => normalizeExternalItem(item));
        schedules = payload.schedules;
        if (candidates.length === 0 && schedules.length === 0) {
          errorMessage = '当前页面没有识别到作业或课程时段，请打开 Blackboard 总日历/课程日历。';
          return;
        }
        selected = new Set(candidates.map((item) => item.externalId ?? item.sourceUrl));
        stage = 'preview';
        errorMessage = '';
      } catch {
        errorMessage = '读取 Blackboard 数据失败，请确认当前页面是总日历或课程日历。';
      }
    }).then((unlisten) => {
      stop = unlisten;
    });
    return () => stop?.();
  });

  async function startLogin() {
    stage = 'login';
    errorMessage = '';
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

  async function readCalendar() {
    if (!isTauri()) {
      errorMessage = 'Blackboard 导入只能在 MemoFlow 桌面版中运行。';
      return;
    }
    try {
      await invoke('capture_blackboard_calendar');
    } catch (error) {
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
  {:else if stage === 'login'}
    <div class="step-card">
      <span class="step-number">2</span>
      <div><b>登录后打开总日历</b><p>完成 SSO 登录，并打开课程总日历/活动页面，然后回到这里继续。</p></div>
    </div>
    <div class="dialog-actions">
      <button class="secondary-button" type="button" on:click={() => (stage = 'start')}>返回</button>
      <button class="primary-button" type="button" on:click={readCalendar}>读取总日历</button>
    </div>
  {:else if stage === 'preview'}
    <div class="preview-summary"><b>导入预览</b><span>{selected.size} 项目 · {schedules.length} 节课程</span></div>
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
  .step-card { display:flex; gap:13px; align-items:flex-start; margin-bottom:18px; border:1px solid var(--line); border-radius:13px; padding:16px; background:var(--surface-subtle); }
  .step-number { display:grid; place-items:center; width:26px; height:26px; flex:none; border-radius:7px; background:var(--accent-soft); color:var(--accent); font-weight:800; }
  .step-card b { display:block; margin-top:2px; }
  .step-card p { margin:7px 0 0; color:var(--ink-soft); font-size:.82rem; line-height:1.55; }
  .full { width:100%; }
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

