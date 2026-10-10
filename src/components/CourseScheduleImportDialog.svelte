<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { getCurrentWebview } from '@tauri-apps/api/webview';
  import type { ScheduleCandidate } from '$lib/domain/types';
  import { parseCourseScheduleZip, type ScheduleZipError } from '$lib/import/schedule-zip';

  const dispatch = createEventDispatcher<{
    close: void;
    confirm: { schedules: ScheduleCandidate[]; errors: ScheduleZipError[]; fileCount: number };
  }>();

  let fileInput: HTMLInputElement;
  let fileName = '';
  let schedules: ScheduleCandidate[] = [];
  let errors: ScheduleZipError[] = [];
  let fileCount = 0;
  let stage: 'idle' | 'reading' | 'preview' | 'done' = 'idle';
  let errorMessage = '';
  let isDragging = false;

  function formatWeekday(value: number): string {
    return ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][value - 1] ?? `第 ${value} 天`;
  }

  function applyArchive(name: string, bytes: Uint8Array) {
    fileName = name;
    stage = 'reading';
    errorMessage = '';
    schedules = [];
    errors = [];
    try {
      const result = parseCourseScheduleZip(bytes);
      schedules = result.schedules;
      errors = result.errors;
      fileCount = result.fileCount;
      if (schedules.length === 0) {
        stage = 'idle';
        errorMessage = errors[0]?.message ?? '没有识别到可导入的课程时段。';
        return;
      }
      stage = 'preview';
    } catch (error) {
      stage = 'idle';
      errorMessage = error instanceof Error ? error.message : '课表 ZIP 读取失败。';
    }
  }

  async function readFile(file: File | undefined) {
    if (!file) return;
    applyArchive(file.name, new Uint8Array(await file.arrayBuffer()));
  }

  async function handleFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    await readFile(file);
    input.value = '';
  }

  function isZipFile(file: File): boolean {
    return isZipName(file.name, file.type);
  }

  function isZipName(name: string, type = ''): boolean {
    return name.toLowerCase().endsWith('.zip') || ['application/zip', 'application/x-zip-compressed'].includes(type);
  }

  function fileNameFromPath(path: string): string {
    return path.split(/[\\/]/).pop() || path;
  }

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    isDragging = true;
  }

  function handleDragLeave(event: DragEvent) {
    const currentTarget = event.currentTarget as HTMLElement;
    const relatedTarget = event.relatedTarget as Node | null;
    if (!relatedTarget || !currentTarget.contains(relatedTarget)) isDragging = false;
  }

  async function handleDrop(event: DragEvent) {
    event.preventDefault();
    isDragging = false;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    if (files.length > 1) {
      stage = 'idle';
      errorMessage = '一次只能导入一个课表 ZIP 文件。';
      return;
    }
    if (!isZipFile(files[0])) {
      stage = 'idle';
      errorMessage = '只能导入 ZIP 格式的课表文件。';
      return;
    }
    await readFile(files[0]);
  }

  async function handleNativeDrop(paths: string[]) {
    if (paths.length > 1) {
      stage = 'idle';
      errorMessage = '一次只能导入一个课表 ZIP 文件。';
      return;
    }
    const path = paths[0];
    if (!path) return;
    const name = fileNameFromPath(path);
    if (!isZipName(name)) {
      stage = 'idle';
      errorMessage = '只能导入 ZIP 格式的课表文件。';
      return;
    }
    fileName = name;
    stage = 'reading';
    errorMessage = '';
    try {
      const bytes = await invoke<number[]>('read_schedule_archive', { path });
      applyArchive(name, new Uint8Array(bytes));
    } catch (error) {
      stage = 'idle';
      errorMessage = error instanceof Error ? error.message : typeof error === 'string' ? error : '课表 ZIP 读取失败。';
    }
  }

  onMount(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    try {
      void getCurrentWebview().onDragDropEvent(({ payload }) => {
        if (payload.type === 'enter' || payload.type === 'over') {
          isDragging = true;
          return;
        }
        isDragging = false;
        if (payload.type === 'drop') void handleNativeDrop(payload.paths);
      }).then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      }).catch(() => {});
    } catch {
      // The browser preview does not expose Tauri's native drag API.
    }
    return () => {
      disposed = true;
      unlisten?.();
    };
  });

  function confirmImport() {
    dispatch('confirm', { schedules, errors, fileCount });
    stage = 'done';
  }
</script>

<div class="schedule-import-dialog">
  <div class="modal-header">
    <div>
      <p class="eyebrow">本地文件</p>
      <h2>导入课表 ZIP</h2>
    </div>
    <button class="close-button" type="button" aria-label="关闭" on:click={() => dispatch('close')}>×</button>
  </div>

  {#if errorMessage}
    <div class="error-message" role="alert">{errorMessage}</div>
  {/if}

  {#if stage === 'idle'}
    <div class="step-card">
      <span class="step-number">1</span>
      <div><b>选择学校课表压缩包</b><p>文件只在本机读取，不会上传。ZIP 内应包含一个或多个 .ICS 文件。</p></div>
    </div>
    <input bind:this={fileInput} class="file-input" type="file" accept=".zip,application/zip" aria-label="课表 ZIP 文件" on:change={handleFile} />
    <div
      class:dragging={isDragging}
      class="drop-zone"
      role="region"
      aria-label="拖放课表 ZIP 文件"
      on:dragover={handleDragOver}
      on:dragleave={handleDragLeave}
      on:drop={handleDrop}
    >
      <span class="drop-icon" aria-hidden="true">↓</span>
      <b>拖入课表 ZIP 文件</b>
      <small>或点击下方按钮选择文件</small>
      <button class="primary-button" type="button" on:click={() => fileInput?.click()}>选择课表 ZIP</button>
    </div>
  {:else if stage === 'reading'}
    <div class="read-status pending" role="status" aria-live="polite">正在读取 {fileName}…</div>
  {:else if stage === 'preview'}
    <div class="preview-summary"><b>导入预览</b><span>{schedules.length} 节课程 · {fileCount} 个 ICS 文件</span></div>
    {#if errors.length > 0}
      <div class="warning-message" role="status">
        <b>{errors.length} 个文件未能识别，其他课程仍可导入。</b>
        <ul>
          {#each errors as error}
            <li>{error.fileName}：{error.message}</li>
          {/each}
        </ul>
      </div>
    {/if}
    <div class="schedule-list">
      {#each schedules as schedule}
        <article class="schedule-candidate">
          <div>
            <strong>{schedule.courseName}</strong>
            <small>{formatWeekday(schedule.weekday)} · {schedule.startTime}–{schedule.endTime}{schedule.location ? ` · ${schedule.location}` : ''}</small>
          </div>
          {#if schedule.courseCode}<span class="tag">{schedule.courseCode}</span>{/if}
        </article>
      {/each}
    </div>
    <div class="dialog-actions">
      <button class="secondary-button" type="button" on:click={() => (stage = 'idle')}>重新选择</button>
      <button class="primary-button" type="button" on:click={confirmImport}>确认导入</button>
    </div>
  {:else}
    <div class="success-state" role="status"><span class="success-icon">✓</span><h3>课表已导入</h3><p>课程时段已写入周课表，没有创建作业或提醒。</p><button class="primary-button" type="button" on:click={() => dispatch('close')}>返回周课表</button></div>
  {/if}
</div>

<style>
  .eyebrow { margin:0 0 5px; color:var(--ink-muted); font-size:.75rem; letter-spacing:.08em; text-transform:uppercase; }
  h2 { margin:0; font-size:1.45rem; letter-spacing:-.035em; }
  .error-message, .warning-message { margin-bottom:14px; border-radius:8px; padding:10px 12px; font-size:.8rem; line-height:1.45; }
  .error-message { background:#fff0e9; color:var(--danger); }
  .warning-message { background:#fff8e9; color:#93631a; }
  .warning-message ul { margin:7px 0 0; padding-left:18px; }
  .warning-message li + li { margin-top:4px; }
  .step-card { display:flex; gap:13px; align-items:flex-start; margin-bottom:18px; border:1px solid var(--line); border-radius:13px; padding:16px; background:var(--surface-subtle); }
  .step-number { display:grid; place-items:center; width:26px; height:26px; flex:none; border-radius:7px; background:var(--accent-soft); color:var(--accent); font-weight:800; }
  .step-card b { display:block; margin-top:2px; }
  .step-card p { margin:7px 0 0; color:var(--ink-soft); font-size:.82rem; line-height:1.55; }
  .file-input { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
  .drop-zone { display:grid; justify-items:center; gap:7px; border:1px dashed var(--line); border-radius:13px; padding:24px 16px; background:var(--surface-subtle); color:var(--ink-soft); text-align:center; transition: border-color .16s ease, background .16s ease; }
  .drop-zone.dragging { border-color:var(--accent); background:var(--accent-soft); }
  .drop-icon { display:grid; place-items:center; width:34px; height:34px; border-radius:10px; background:var(--accent-soft); color:var(--accent); font-size:1.3rem; font-weight:800; }
  .drop-zone b { color:var(--ink); }
  .drop-zone small { color:var(--ink-muted); font-size:.75rem; }
  .read-status { border:1px solid #f0d3a2; border-radius:10px; padding:12px; background:#fff8e9; color:#93631a; font-size:.8rem; }
  .preview-summary { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; color:var(--ink-soft); font-size:.84rem; }
  .preview-summary span { color:var(--accent); font-weight:700; }
  .schedule-list { display:flex; flex-direction:column; gap:7px; max-height:330px; overflow:auto; }
  .schedule-candidate { display:flex; align-items:center; justify-content:space-between; gap:12px; border:1px solid var(--line); border-radius:8px; padding:11px; }
  .schedule-candidate div { display:flex; min-width:0; flex-direction:column; gap:4px; }
  .schedule-candidate strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .schedule-candidate small { color:var(--ink-muted); font-size:.72rem; }
  .tag { flex:none; border-radius:5px; padding:3px 6px; background:var(--accent-soft); color:var(--accent-strong); font-size:.65rem; font-weight:700; }
  .dialog-actions { display:flex; justify-content:flex-end; gap:9px; margin-top:20px; }
  .primary-button, .secondary-button { border-radius:10px; padding:10px 14px; font-weight:700; }
  .secondary-button { border:1px solid var(--line); background:var(--surface); color:var(--ink-soft); }
  .secondary-button:hover { border-color:var(--accent); color:var(--accent); }
  .success-state { display:grid; place-items:center; padding:26px 10px 10px; text-align:center; }
  .success-state h3 { margin:14px 0 5px; }
  .success-state p { margin:0 0 18px; color:var(--ink-soft); font-size:.82rem; }
  .success-icon { display:grid; place-items:center; width:44px; height:44px; border-radius:50%; background:#e7f6ed; color:var(--success); font-size:1.4rem; font-weight:800; }
</style>
