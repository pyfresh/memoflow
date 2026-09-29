<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { View } from '$lib/domain/navigation';

  export let activeView: View = 'overview';
  export let activeCategory = 'all';

  const dispatch = createEventDispatcher<{
    navigate: View;
    filterCategory: string;
    importBlackboard: void;
    seedDemoData: void;
    exportData: void;
    exportPlainText: void;
  }>();

  const views: Array<{ id: View; icon: string; label: string }> = [
    { id: 'overview', icon: '▦', label: '快速一览' },
    { id: 'memos', icon: '▤', label: '备忘录' },
    { id: 'reminders', icon: '◷', label: '提醒' },
  ];
  const categories = [
    { value: 'course', label: '课程', color: '#73c7bc' },
    { value: 'life', label: '生活', color: '#78bf9f' },
    { value: 'inbox', label: '待整理', color: '#e7a46f' },
  ];
</script>

<aside class="app-sidebar">
  <div class="brand"><span class="brand-mark">M</span><span>MemoFlow</span></div>

  <nav class="nav-group" aria-label="主导航">
    {#each views as view}
      <button class:active={activeView === view.id} class="nav-button" type="button" aria-current={activeView === view.id ? 'page' : undefined} on:click={() => dispatch('navigate', view.id)}>
        <span class="nav-icon" aria-hidden="true">{view.icon}</span><span>{view.label}</span>
      </button>
    {/each}
  </nav>

  <p class="sidebar-label">分类</p>
  {#each categories as category}
    <button
      class:active={activeCategory === category.value}
      class="category-row"
      type="button"
      aria-pressed={activeCategory === category.value}
      on:click={() => dispatch('filterCategory', activeCategory === category.value ? 'all' : category.value)}
    >
      <span class="category-dot" style={`background:${category.color}`}></span><span>{category.label}</span>
    </button>
  {/each}

  <div class="sidebar-bottom">
    <button class="sidebar-action" type="button" on:click={() => dispatch('importBlackboard')}>⌁　同步 Blackboard</button>
    <button class="sidebar-action" type="button" on:click={() => dispatch('seedDemoData')}>✦　加载示例数据</button>
    <button class="sidebar-action" type="button" on:click={() => dispatch('exportData')}>↓　导出 Markdown</button>
    <button class="sidebar-action" type="button" on:click={() => dispatch('exportPlainText')}>↓　导出纯文本</button>
    <p class="sidebar-footnote">数据保存在本机</p>
  </div>
</aside>

<style>
  .category-row { width:100%; border:1px solid transparent; background:transparent; color:#c4d3cf; text-align:left; transition:background .18s ease, border-color .18s ease, color .18s ease; }
  .category-row:hover, .category-row.active { border-color:rgba(255,255,255,.08); background:var(--nav-soft); color:#fff; }
  .sidebar-footnote { margin:9px 4px 0; color:#78918d; font-size:.68rem; text-align:center; }
</style>
