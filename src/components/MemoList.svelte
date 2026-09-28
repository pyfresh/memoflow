<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Memo } from '$lib/domain/types';

  export let items: Memo[] = [];
  export let query = '';

  const dispatch = createEventDispatcher<{ select: Memo }>();

  function formatUpdated(value: string) {
    return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value));
  }

  function excerpt(value: string) {
    return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '没有正文内容';
  }
</script>

<section class="memo-list-section" aria-label="备忘录列表">
  {#if items.length === 0}
    <div class="empty-state">
      <span class="empty-mark">○</span>
      <p>{query ? '没有匹配的备忘录。' : '还没有备忘录，先写下第一件要记住的事吧。'}</p>
    </div>
  {:else}
    <div class="memo-grid">
      {#each items as memo (memo.id)}
        <article class="memo-card">
          <button type="button" class="memo-card-button" on:click={() => dispatch('select', memo)}>
            <span class="memo-card-topline">
              <span class="memo-category">{memo.categoryId === 'course' || memo.source === 'blackboard' ? '课程' : memo.categoryId === 'inbox' ? '待整理' : '生活'}</span>
              <span class="memo-updated">{formatUpdated(memo.updatedAt)}</span>
            </span>
            <strong>{memo.title}</strong>
            <span class="memo-excerpt">{excerpt(memo.richText)}</span>
            {#if memo.tags.length}
              <span class="memo-tags">
                {#each memo.tags.slice(0, 3) as tag}<span>#{tag}</span>{/each}
              </span>
            {/if}
          </button>
        </article>
      {/each}
    </div>
  {/if}
</section>

<style>
  .memo-list-section { min-width:0; }
  .memo-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:14px; }
  .memo-card { min-width:0; border:1px solid var(--line); border-radius:10px; background:var(--surface); box-shadow:var(--shadow-sm); transition:border-color .18s ease, transform .18s ease, box-shadow .18s ease; }
  .memo-card:hover { border-color:var(--line-strong); box-shadow:0 10px 24px rgba(27,48,52,.09); transform:translateY(-2px); }
  .memo-card-button { display:flex; flex-direction:column; gap:10px; width:100%; min-height:165px; border:0; padding:16px; background:transparent; color:var(--ink); text-align:left; }
  .memo-card-topline { display:flex; align-items:center; justify-content:space-between; gap:8px; color:var(--ink-muted); font-size:.7rem; }
  .memo-category { color:var(--accent-strong); font-weight:750; }
  .memo-updated { white-space:nowrap; }
  .memo-card strong { overflow:hidden; font-size:1rem; text-overflow:ellipsis; white-space:nowrap; }
  .memo-excerpt { display:-webkit-box; overflow:hidden; color:var(--ink-soft); font-size:.8rem; line-height:1.55; -webkit-box-orient:vertical; -webkit-line-clamp:3; line-clamp:3; }
  .memo-tags { display:flex; flex-wrap:wrap; gap:5px; margin-top:auto; color:var(--ink-muted); font-size:.68rem; }
  .memo-tags span { border-radius:4px; padding:3px 5px; background:var(--surface-tint); }
  .empty-state { padding:60px 18px; color:var(--ink-muted); font-size:.85rem; line-height:1.55; text-align:center; }
  .empty-state p { margin:10px 0 0; }
  .empty-mark { display:inline-grid; place-items:center; width:38px; height:38px; border:1px dashed var(--line-strong); border-radius:50%; color:var(--accent); font-size:1.15rem; }
  @media (max-width:1100px) { .memo-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
  @media (max-width:700px) { .memo-grid { grid-template-columns:1fr; } }
</style>