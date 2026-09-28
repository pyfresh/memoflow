<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  const dispatch = createEventDispatcher<{
    newMemo: void;
    newReminder: void;
    importBlackboard: void;
    exportData: void;
    exportPlainText: void;
  }>();
</script>

<aside class="app-sidebar">
  <div class="brand"><span class="brand-mark">M</span><span>MemoFlow</span></div>

  <nav class="nav-group" aria-label="主导航">
    <button class="nav-button active" type="button"><span class="nav-icon">▦</span><span>我的备忘录</span></button>
    <button class="nav-button" type="button" on:click={() => dispatch('newMemo')}><span class="nav-icon">＋</span><span>新建备忘录</span></button>
    <button class="nav-button" type="button" aria-label="新建提醒" on:click={() => dispatch('newReminder')}><span class="nav-icon" aria-hidden="true">◷</span><span>新建提醒</span></button>
    <button class="nav-button" type="button" on:click={() => dispatch('importBlackboard')}><span class="nav-icon">⌁</span><span>Blackboard</span></button>
  </nav>

  <p class="sidebar-label">分类</p>
  <div class="category-row"><span class="category-dot"></span><span>课程</span></div>
  <div class="category-row"><span class="category-dot" style="background:#78bf9f"></span><span>生活</span></div>
  <div class="category-row"><span class="category-dot" style="background:#e7a46f"></span><span>待整理</span></div>

  <div class="sidebar-bottom">
    <button class="sidebar-action" type="button" on:click={() => dispatch('importBlackboard')}>⌁　同步 Blackboard</button>
    <button class="sidebar-action" type="button" on:click={() => dispatch('exportData')}>↓　导出 Markdown</button>
    <button class="sidebar-action" type="button" on:click={() => dispatch('exportPlainText')}>↓　导出纯文本</button>
    <p class="sidebar-footnote">数据保存在本机</p>
  </div>
</aside>

<style>
  .sidebar-footnote { margin:9px 4px 0; color:#78918d; font-size:.68rem; text-align:center; }
</style>