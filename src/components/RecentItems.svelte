<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { RecentItem } from '$lib/domain/types';
  export let items: RecentItem[] = [];
  export let query = '';

  const dispatch = createEventDispatcher<{ select: RecentItem; status: { item: RecentItem; status: 'completed' | 'ignored' } }>();

  function formatDue(value: string | null): string {
    if (!value) return '无提醒';
    const date = new Date(value);
    return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  }
</script>

<section class="panel recent-panel" aria-label="最近事项">
  <div class="panel-heading">
    <h2>最近事项</h2>
    <button type="button" on:click={() => dispatch('select', items[0])}>全部</button>
  </div>

  {#if items.length === 0}
    <div class="empty-state">{query ? '没有匹配的事项。' : '还没有事项，先创建一条备忘录吧。'}</div>
  {:else}
    <div class="recent-list">
      {#each items as item (item.id)}
        <article class="recent-item">
          <button type="button" class="recent-main" on:click={() => dispatch('select', item)}>
            <span class="recent-title">{item.title}</span>
            <span class:overdue={item.status === 'pending' && item.dueAt && new Date(item.dueAt).getTime() < Date.now()} class="recent-meta">
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
  .recent-main { width:100%; border:0; background:transparent; text-align:left; }
  .recent-actions { display:flex; gap:6px; margin-top:8px; }
  .recent-actions button { border:0; border-radius:6px; padding:4px 7px; background:#f0f3f8; color:var(--ink-soft); font-size:.68rem; }
  .recent-actions button:hover { background:#e6ebf5; color:var(--accent); }
</style>


