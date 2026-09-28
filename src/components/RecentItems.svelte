<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { RecentItem } from '$lib/domain/types';
  export let items: RecentItem[] = [];
  export let query = '';
  export let title = '最近事项';
  export let eyebrow = '个人工作台';
  export let emptyMessage = '还没有事项，先创建一条备忘录吧。';

  const dispatch = createEventDispatcher<{ select: RecentItem; status: { item: RecentItem; status: 'completed' | 'ignored' } }>();

  function formatDue(value: string | null): string {
    if (!value) return '无提醒';
    const date = new Date(value);
    return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function isOverdue(item: RecentItem) {
    return item.status === 'pending' && !!item.dueAt && new Date(item.dueAt).getTime() < Date.now();
  }
</script>

<section class="panel recent-panel" aria-label="最近事项">
  <div class="panel-heading">
    <div>
      <p class="panel-eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
    </div>
    <span class="item-count">{items.length}</span>
  </div>

  {#if items.length === 0}
    <div class="empty-state">
      <span class="empty-mark">○</span>
      <p>{query ? '没有匹配的事项。' : emptyMessage}</p>
    </div>
  {:else}
    <div class="recent-list">
      {#each items as item (item.id)}
        <article class="recent-item">
          <button type="button" class="recent-main" on:click={() => dispatch('select', item)}>
            <span class="recent-title">{item.title}</span>
            <span class:overdue={isOverdue(item)} class="recent-meta">
              <span>{formatDue(item.dueAt)}</span>
              <span class:course={item.source === 'blackboard'} class:done={item.status !== 'pending'} class="tag">{item.category}</span>
            </span>
          </button>
          {#if item.status === 'pending'}
            <div class="recent-actions">
              <button type="button" on:click={() => dispatch('status', { item, status: 'completed' })}>完成</button>
              <button type="button" on:click={() => dispatch('status', { item, status: 'ignored' })}>忽略</button>
            </div>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</section>

<style>
  .panel-eyebrow { margin:0 0 4px; color:var(--accent); font-size:.64rem; font-weight:750; letter-spacing:.12em; text-transform:uppercase; }
  .item-count { display:grid; place-items:center; min-width:24px; height:24px; border-radius:6px; background:var(--surface-tint); color:var(--accent-strong); font-size:.72rem; font-weight:750; }
  .empty-state p { margin:10px 0 0; }
  .empty-mark { display:inline-grid; place-items:center; width:33px; height:33px; border:1px dashed var(--line-strong); border-radius:50%; color:var(--accent); font-size:1.1rem; }
  .recent-main { width:100%; border:0; background:transparent; text-align:left; }
  .recent-actions { display:flex; gap:6px; margin-top:8px; }
  .recent-actions button { border:0; border-radius:5px; padding:4px 7px; background:var(--surface-tint); color:var(--ink-soft); font-size:.68rem; }
  .recent-actions button:hover { background:var(--accent-soft); color:var(--accent-strong); }
</style>