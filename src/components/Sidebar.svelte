<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { View } from '$lib/domain/navigation';

  export let activeView: View = 'overview';

  const dispatch = createEventDispatcher<{
    navigate: View;
    importBlackboard: void;
    openNotificationSettings: void;
    seedDemoData: void;
    exportData: void;
    exportPlainText: void;
  }>();

  const views: Array<{ id: View; icon: string; label: string }> = [
    { id: 'overview', icon: '▦', label: '快速一览' },
    { id: 'memos', icon: '▤', label: '备忘录' },
    { id: 'reminders', icon: '◷', label: '提醒' },
    { id: 'schedule', icon: '▥', label: '周课表' },
    { id: 'countdown', icon: '◌', label: '倒计时' },
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

  <div class="sidebar-bottom">
    <button class="sidebar-action" type="button" on:click={() => dispatch('importBlackboard')}>⌁　从 Blackboard 导入作业</button>
    <button class="sidebar-action" type="button" on:click={() => dispatch('openNotificationSettings')}>◉　通知设置</button>
    <button class="sidebar-action" type="button" on:click={() => dispatch('seedDemoData')}>✦　加载示例数据</button>
    <button class="sidebar-action" type="button" on:click={() => dispatch('exportData')}>↓　导出 Markdown</button>
    <button class="sidebar-action" type="button" on:click={() => dispatch('exportPlainText')}>↓　导出纯文本</button>
    <p class="sidebar-footnote">数据保存在本机</p>
  </div>
</aside>

<style>
  .sidebar-footnote { margin:9px 4px 0; color:#78918d; font-size:.68rem; text-align:center; }
</style>
