<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { MemoDraft } from '$lib/data/repository';

  export let onSave: (draft: MemoDraft) => void = () => {};
  export let initial: Partial<MemoDraft> = {};

  const dispatch = createEventDispatcher<{ save: MemoDraft }>();
  let title = initial.title ?? '';
  let body = initial.body ?? '';
  let reminderAt = initial.reminderAt ?? '';
  let recurrenceRule = initial.recurrenceRule ?? null;
  let categoryId = initial.categoryId ?? 'life';
  let tagsText = (initial.tags ?? []).join(', ');
  let standalone = initial.standalone ?? false;

  function formatBold() {
    if (!body.trim()) return;
    body = `<strong>${body.replace(/<[^>]+>/g, '')}</strong>`;
  }

  function formatList() {
    const text = body.replace(/<[^>]+>/g, '').trim();
    if (!text) return;
    body = `<ul><li>${text}</li></ul>`;
  }

  function insertLink() {
    const url = typeof window !== 'undefined' ? window.prompt('输入链接地址') : null;
    if (!url) return;
    const label = body.replace(/<[^>]+>/g, '').trim() || url;
    body = `${body.replace(/<[^>]+>/g, '')}<p><a href="${url}" target="_blank" rel="noreferrer">${label}</a></p>`;
  }

  function submit() {
    const draft: MemoDraft = {
      id: initial.id,
      standalone,
      title: title.trim(),
      body,
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
    <button class="primary" type="submit">{standalone ? '保存提醒' : '保存备忘录'}</button>
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
      <textarea id="memo-body" aria-label="正文" bind:value={body} rows="7" placeholder="写下详细内容、清单或链接"></textarea>
    </div>

    <div class="form-grid">
      <label>
        <span>分类</span>
        <select aria-label="分类" bind:value={categoryId}>
          <option value="course">课程</option>
          <option value="life">生活</option>
          <option value="inbox">待整理</option>
        </select>
      </label>
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
</form>

<style>
  .editor-form { display:flex; flex-direction:column; gap:18px; }
  .editor-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; }
  .eyebrow { margin:0 0 5px; color:var(--ink-muted); font-size:.75rem; letter-spacing:.08em; text-transform:uppercase; }
  h2 { margin:0; font-size:1.45rem; letter-spacing:-.035em; }
  label { display:flex; flex-direction:column; gap:7px; color:var(--ink-soft); font-size:.8rem; font-weight:650; }
  .field { display:flex; flex-direction:column; gap:7px; }
  input, textarea, select { box-sizing:border-box; width:100%; border:1px solid var(--line); border-radius:11px; padding:11px 12px; background:var(--surface); color:var(--ink); font:inherit; font-weight:400; outline:0; }
  textarea { resize:vertical; line-height:1.6; }
  input:focus, textarea:focus, select:focus { border-color:var(--accent); box-shadow:0 0 0 3px rgba(79,109,245,.12); }
  .toolbar { display:flex; gap:5px; margin-bottom:-2px; }
  .toolbar button { width:30px; height:29px; border:1px solid var(--line); border-radius:7px; background:var(--surface-subtle); color:var(--ink-soft); }
  .toolbar button:hover { border-color:var(--accent); color:var(--accent); }
  .form-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .primary { border:0; border-radius:10px; padding:10px 14px; background:var(--accent); color:#fff; font:inherit; font-weight:700; cursor:pointer; box-shadow:0 5px 14px rgba(79,109,245,.2); }
  .primary:hover { background:var(--accent-strong); }
  .standalone-toggle { flex-direction:row; align-items:center; gap:8px; font-weight:500; }
  .standalone-toggle input { width:auto; accent-color:var(--accent); }
  .standalone-note { margin:-4px 0; color:var(--ink-soft); font-size:.82rem; }
  @media (max-width:700px) { .editor-heading { flex-direction:column; } .form-grid { grid-template-columns:1fr; } }
</style>
