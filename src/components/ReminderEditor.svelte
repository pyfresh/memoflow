<script lang="ts">
  import { onMount } from 'svelte';
  import { createEventDispatcher } from 'svelte';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import type { MemoDraft } from '$lib/data/repository';
  import SelectMenu from './SelectMenu.svelte';

  export let onSave: (draft: MemoDraft) => void = () => {};
  export let initial: Partial<MemoDraft> = {};
  export let existingMemoId: string | null = null;
  export let existingReminderId: string | null = null;
  export let onComplete: (detail: { memoId: string | null; reminderId: string | null }) => void = () => {};
  export let onDelete: (detail: { memoId: string | null; reminderId: string | null }) => void = () => {};

  const dispatch = createEventDispatcher<{
    save: MemoDraft;
    cancel: void;
    complete: { memoId: string | null; reminderId: string | null };
    delete: { memoId: string | null; reminderId: string | null };
  }>();
  const categoryOptions = [
    { value: 'course', label: '课程' },
    { value: 'life', label: '生活' },
    { value: 'inbox', label: '待整理' },
  ];

  function normalizeUrl(value: string): string {
    try { return new URL(value, typeof window !== 'undefined' ? window.location.href : undefined).href; }
    catch { return value; }
  }

  function cleanLegacySourceLink(html: string, sourceUrl: string): string {
    if (!html || !sourceUrl || typeof DOMParser === 'undefined') return html;
    const document = new DOMParser().parseFromString(`<div id="memo-body-root">${html}</div>`, 'text/html');
    const root = document.querySelector('#memo-body-root');
    if (!root) return html;
    const normalizedSource = normalizeUrl(sourceUrl);
    for (const anchor of Array.from(root.querySelectorAll('a[href]'))) {
      if (anchor.textContent?.trim() !== '打开 Blackboard 项目' || normalizeUrl(anchor.getAttribute('href') ?? '') !== normalizedSource) continue;
      const parent = anchor.parentElement;
      if (parent?.tagName.toLowerCase() === 'p' && parent.textContent?.trim() === anchor.textContent?.trim()) parent.remove();
      else anchor.remove();
    }
    return root.innerHTML;
  }

  function isSafeExternalUrl(value: string): boolean {
    try { const protocol = new URL(value).protocol; return protocol === 'http:' || protocol === 'https:'; }
    catch { return false; }
  }

  function isAssignmentUrl(value: string): boolean {
    try {
      const url = new URL(value);
      return url.hostname.toLowerCase() === 'bb.cuhk.edu.cn'
        && url.pathname.toLowerCase().includes('/webapps/assignment/uploadassignment')
        && Boolean(url.searchParams.get('content_id')) && Boolean(url.searchParams.get('course_id'));
    } catch { return false; }
  }
  let title = initial.title ?? '';
  let sourceUrl = initial.sourceUrl ?? '';
  let sourceKind = initial.sourceKind ?? (isAssignmentUrl(sourceUrl) ? 'assignment' : sourceUrl.includes('/calendar/event/') ? 'event' : 'unknown');
  let sourceError = '';
  let body = cleanLegacySourceLink(initial.body ?? '', sourceUrl);
  let reminderAt = initial.reminderAt ?? '';
  let recurrenceRule = initial.recurrenceRule ?? null;
  let categoryId = initial.categoryId ?? 'life';
  let tagsText = (initial.tags ?? []).join(', ');
  let standalone = initial.standalone ?? false;
  let bodyEditor: HTMLDivElement;

  onMount(() => {
    if (bodyEditor) bodyEditor.innerHTML = body;
  });

  $: if (bodyEditor && bodyEditor.innerHTML !== body) bodyEditor.innerHTML = body;

  function updateBody(event: Event) {
    body = (event.currentTarget as HTMLDivElement).innerHTML;
  }

  function setBody(nextBody: string) {
    body = nextBody;
    if (bodyEditor && bodyEditor.innerHTML !== nextBody) bodyEditor.innerHTML = nextBody;
  }

  async function openSource() {
    if (!isSafeExternalUrl(sourceUrl) || sourceKind !== 'assignment') return;
    sourceError = '';
    try {
      if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) await openUrl(sourceUrl);
      else window.open(sourceUrl, '_blank', 'noopener,noreferrer');
    } catch { sourceError = '无法打开作业提交页面，请先在打开的浏览器中登录 Blackboard。'; }
  }

  function formatBold() {
    if (!body.trim()) return;
    setBody(`<strong>${body.replace(/<[^>]+>/g, '')}</strong>`);
  }

  function formatList() {
    const text = body.replace(/<[^>]+>/g, '').trim();
    if (!text) return;
    setBody(`<ul><li>${text}</li></ul>`);
  }

  function insertLink() {
    const url = typeof window !== 'undefined' ? window.prompt('输入链接地址') : null;
    if (!url) return;
    const label = body.replace(/<[^>]+>/g, '').trim() || url;
    setBody(`${body.replace(/<[^>]+>/g, '')}<p><a href="${url}" target="_blank" rel="noreferrer">${label}</a></p>`);
  }

  function completeItem() {
    if (!existingReminderId) return;
    const detail = { memoId: existingMemoId, reminderId: existingReminderId };
    onComplete(detail);
    dispatch('complete', detail);
  }

  function deleteItem() {
    if (!existingMemoId && !existingReminderId) return;
    const detail = { memoId: existingMemoId, reminderId: existingReminderId };
    onDelete(detail);
    dispatch('delete', detail);
  }

  function submit() {
    const draft: MemoDraft = {
      id: initial.id,
      standalone,
      title: title.trim(),
      body,
      sourceUrl: sourceUrl || null,
      sourceKind,
      reminderAt,
      recurrenceRule,
      categoryId,
      tags: tagsText.split(',').map((tag) => tag.trim()).filter(Boolean),
    };
    onSave(draft);
    dispatch('save', draft);
  }
</script>

<form class="editor-form" on:submit|preventDefault={submit}>
  <div class="editor-heading">
    <div>
      <p class="eyebrow">{standalone ? '新建提醒' : '新建事项'}</p>
      <h2>{standalone ? '只提醒我这件事' : '写下现在要记住的事'}</h2>
    </div>
    <div class="editor-actions">
      <button class="editor-cancel" type="button" aria-label="关闭编辑器" title="关闭" on:click={() => dispatch('cancel')}>×</button>
      <button class="primary" type="submit">{standalone ? '保存提醒' : '保存备忘录'}</button>
    </div>
  </div>

  <label>
    <span>标题</span>
    <input aria-label="标题" bind:value={title} required placeholder="例如：买咖啡豆" />
  </label>

  {#if !standalone}
    <div class="field">
      <label for="memo-body">正文</label>
      <div class="toolbar" aria-label="富文本工具栏">
        <button type="button" aria-label="加粗" on:click={formatBold}><b>B</b></button>
        <button type="button" aria-label="项目列表" on:click={formatList}>☷</button>
        <button type="button" aria-label="插入链接" on:click={insertLink}>↗</button>
      </div>
      {#if sourceKind === 'assignment' && isSafeExternalUrl(sourceUrl)}
        <div class="source-link" role="group" aria-label="Blackboard 来源">
          <span>已定位到作业提交页</span>
          <button class="source-button" type="button" on:click={openSource}>↗ 打开作业</button>
          {#if sourceError}<span class="source-error" role="status">{sourceError}</span>{/if}
        </div>
      {:else if sourceKind === 'event'}
        <div class="source-warning" role="status">尚未定位到作业提交页，请重新打开 Blackboard 课程日历后同步。</div>
      {/if}
      <div id="memo-body" bind:this={bodyEditor} class="body-editor" aria-label="正文" role="textbox" aria-multiline="true" contenteditable="true" data-placeholder="写下详细内容、清单或链接" on:input={updateBody}></div>
    </div>

    <div class="form-grid">
      <div class="field-label">
        <span>分类</span>
        <SelectMenu label="分类" bind:value={categoryId} options={categoryOptions} />
      </div>
      <label>
        <span>标签</span>
        <input aria-label="标签" bind:value={tagsText} placeholder="用逗号分隔，例如：旅行, 清单" />
      </label>
    </div>
  {:else}
    <p class="standalone-note">这条提醒不会创建备忘录，只会出现在最近事项和月历中。</p>
  {/if}

  <label class="standalone-toggle">
    <input type="checkbox" aria-label="仅创建提醒" bind:checked={standalone} />
    <span>仅创建提醒，不建立备忘录</span>
  </label>

  <div class="form-grid">
    <label>
      <span>提醒时间</span>
      <input aria-label="提醒时间" type="datetime-local" bind:value={reminderAt} required />
    </label>
    <label>
      <span>重复</span>
      <select bind:value={recurrenceRule} aria-label="重复">
        <option value={null}>不重复</option>
        <option value="FREQ=DAILY">每天</option>
        <option value="FREQ=WEEKLY">每周</option>
        <option value="FREQ=MONTHLY">每月</option>
      </select>
    </label>
  </div>

  {#if existingReminderId || existingMemoId}
    <div class="editor-footer-actions" role="group" aria-label="事项操作">
      {#if existingReminderId}<button class="complete-action" type="button" on:click={completeItem}>完成</button>{/if}
      <button class="delete-action" type="button" on:click={deleteItem}>删除</button>
    </div>
  {/if}
</form>

<style>
  .editor-form { display:flex; flex-direction:column; gap:18px; }
  .editor-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; }
  .editor-actions { display:flex; align-items:center; gap:8px; flex:none; }
  .editor-footer-actions { display:flex; justify-content:flex-end; align-items:center; gap:12px; margin-top:2px; padding-top:14px; border-top:1px solid var(--line); }
  .eyebrow { margin:0 0 5px; color:var(--accent); font-size:.7rem; font-weight:750; letter-spacing:.12em; text-transform:uppercase; }
  h2 { margin:0; font-size:1.45rem; letter-spacing:-.035em; }
  label, .field-label { display:flex; flex-direction:column; gap:7px; color:var(--ink-soft); font-size:.8rem; font-weight:650; }
  .field { display:flex; flex-direction:column; gap:7px; }
  input, select, .body-editor { box-sizing:border-box; width:100%; border:1px solid var(--line); border-radius:8px; padding:11px 12px; background:var(--surface); color:var(--ink); font:inherit; font-weight:400; outline:0; }
  .body-editor { min-height:150px; max-height:320px; overflow:auto; line-height:1.6; white-space:normal; }
  .body-editor:empty::before { content:attr(data-placeholder); color:var(--ink-muted); pointer-events:none; }
  .body-editor:focus, input:focus, select:focus { border-color:var(--accent); box-shadow:0 0 0 3px rgba(7,143,131,.12); }
  :global(.body-editor p) { margin:0 0 8px; }
  :global(.body-editor p:last-child) { margin-bottom:0; }
  :global(.body-editor ul), :global(.body-editor ol) { margin:0 0 8px 20px; padding:0; }
  .toolbar { display:flex; gap:5px; margin-bottom:-2px; }
  .toolbar button { width:30px; height:29px; border:1px solid var(--line); border-radius:7px; background:var(--surface-subtle); color:var(--ink-soft); }
  .toolbar button:hover { border-color:var(--accent); color:var(--accent); }
  .source-link, .source-warning { display:flex; align-items:center; flex-wrap:wrap; gap:10px; border:1px solid var(--accent-soft); border-radius:8px; padding:10px 12px; background:var(--surface-tint); color:var(--ink-soft); font-size:.78rem; }
  .source-button { border:1px solid var(--accent); border-radius:7px; padding:7px 10px; background:var(--surface); color:var(--accent-strong); font:inherit; font-weight:700; cursor:pointer; }
  .source-button:hover { background:var(--accent-soft); }
  .source-error { flex-basis:100%; color:var(--danger, #b54747); font-size:.75rem; }
  .form-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .primary { border:0; border-radius:8px; padding:10px 14px; background:var(--accent); color:#fff; font:inherit; font-weight:750; cursor:pointer; box-shadow:0 6px 16px rgba(7,143,131,.2); }
  .primary:hover { background:var(--accent-strong); }
  .complete-action, .delete-action { min-width:76px; border:0; border-radius:8px; padding:10px 14px; font:inherit; font-size:.78rem; font-weight:750; cursor:pointer; }
  .complete-action { background:#2e8064; color:#fff; }
  .complete-action:hover, .complete-action:focus-visible { background:#24664f; }
  .delete-action { background:#fff0ed; color:#a3433d; }
  .delete-action:hover, .delete-action:focus-visible { background:#ffe1dc; }
  .editor-cancel { display:grid; place-items:center; width:42px; height:42px; border:1px solid var(--line); border-radius:8px; background:var(--surface); color:var(--ink-soft); font-size:1.25rem; line-height:1; }
  .editor-cancel:hover { border-color:var(--accent); color:var(--accent); background:var(--surface-tint); }
  .standalone-toggle { flex-direction:row; align-items:center; gap:8px; font-weight:500; }
  .standalone-toggle input { width:auto; accent-color:var(--accent); }
  .standalone-note { margin:-4px 0; color:var(--ink-soft); font-size:.82rem; }
  @media (max-width:700px) { .editor-heading { flex-direction:column; } .editor-actions { align-self:flex-end; } .form-grid { grid-template-columns:1fr; } }
</style>
