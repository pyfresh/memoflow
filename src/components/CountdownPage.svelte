<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { countdownProgress } from '$lib/domain/countdowns';
  import type { Countdown } from '$lib/domain/types';

  export let countdowns: Countdown[] = [];

  const dispatch = createEventDispatcher<{
    create: { name: string; totalSeconds: number };
    change: { id: string; status: 'running' | 'paused' };
    reset: string;
    delete: string;
  }>();

  const circumference = 2 * Math.PI * 48;
  let name = '';
  let hours = 0;
  let minutes = 25;
  let seconds = 0;
  let error = '';

  function totalSeconds(): number {
    return Math.floor(Math.max(0, Number(hours) || 0) * 3600 + Math.max(0, Number(minutes) || 0) * 60 + Math.max(0, Number(seconds) || 0));
  }

  function submit() {
    error = '';
    if (!name.trim()) { error = '请填写倒计时名称'; return; }
    const total = totalSeconds();
    if (total <= 0) { error = '倒计时至少需要 1 秒'; return; }
    dispatch('create', { name: name.trim(), totalSeconds: total });
    name = '';
    hours = 0;
    minutes = 25;
    seconds = 0;
  }

  function formatDuration(value: number): string {
    const total = Math.max(0, Math.floor(value));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function statusLabel(status: Countdown['status']): string {
    return { idle: '待开始', running: '进行中', paused: '已暂停', completed: '已完成' }[status];
  }
</script>

<header class="workspace-header page-header">
  <div>
    <p class="workspace-kicker">专注工具</p>
    <h1 class="workspace-title">倒计时</h1>
    <p class="workspace-subtitle">用一个清晰的圆环，掌握当前这一段时间。</p>
  </div>
</header>

<div class="countdown-layout">
  <section class="panel countdown-creator" aria-label="创建倒计时">
    <div class="panel-heading">
      <div>
        <p class="panel-eyebrow">新建</p>
        <h2>设定一段时间</h2>
      </div>
    </div>
    <form class="countdown-form" on:submit|preventDefault={submit}>
      <label>
        <span>名称</span>
        <input aria-label="倒计时名称" bind:value={name} placeholder="例如：专注写作" />
      </label>
      <fieldset>
        <legend>时长</legend>
        <div class="duration-inputs">
          <label><span>小时</span><input aria-label="小时" type="number" min="0" max="99" bind:value={hours} /></label>
          <label><span>分钟</span><input aria-label="分钟" type="number" min="0" max="59" bind:value={minutes} /></label>
          <label><span>秒</span><input aria-label="秒" type="number" min="0" max="59" bind:value={seconds} /></label>
        </div>
      </fieldset>
      {#if error}<p class="countdown-error" role="alert">{error}</p>{/if}
      <button class="primary-button create-button" type="submit">＋ 创建倒计时</button>
    </form>
  </section>

  <section class="countdown-list" aria-label="倒计时列表">
    {#if countdowns.length === 0}
      <div class="panel empty-state countdown-empty">还没有倒计时，先设定一段专注时间。</div>
    {:else}
      {#each countdowns as countdown (countdown.id)}
        {@const progress = countdownProgress(countdown)}
        <article class="panel countdown-card" aria-label={countdown.name}>
          <div class="countdown-card-main">
            <div class="countdown-ring-wrap">
              <svg class="countdown-ring" viewBox="0 0 120 120" role="img" aria-label={`${countdown.name} 剩余进度`}>
                <circle class="ring-track" cx="60" cy="60" r="48" />
                <circle class="ring-progress" cx="60" cy="60" r="48" pathLength="1" style={`stroke-dasharray: 1; stroke-dashoffset: ${1 - progress};`} />
              </svg>
              <div class="ring-content">
                <strong>{formatDuration(countdown.remainingSeconds)}</strong>
                <span>{statusLabel(countdown.status)}</span>
              </div>
              <div class="sr-only" role="progressbar" aria-label={`${countdown.name} 剩余进度`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress * 100)}></div>
            </div>
            <div class="countdown-copy">
              <div class="countdown-title-row">
                <h2>{countdown.name}</h2>
                <span class:completed={countdown.status === 'completed'} class="countdown-status">{statusLabel(countdown.status)}</span>
              </div>
              <p>{formatDuration(countdown.totalSeconds)} 总时长</p>
              <div class="countdown-actions">
                {#if countdown.status === 'running'}
                  <button class="secondary-action" type="button" on:click={() => dispatch('change', { id: countdown.id, status: 'paused' })}>Ⅱ 暂停</button>
                {:else if countdown.status !== 'completed'}
                  <button class="primary-button" type="button" on:click={() => dispatch('change', { id: countdown.id, status: 'running' })}>▶ 开始</button>
                {/if}
                <button class="secondary-action" type="button" on:click={() => dispatch('reset', countdown.id)}>↻ 重置</button>
                <button class="text-action danger-action" type="button" on:click={() => dispatch('delete', countdown.id)}>删除</button>
              </div>
            </div>
          </div>
        </article>
      {/each}
    {/if}
  </section>
</div>

<style>
  .countdown-layout { display:grid; grid-template-columns:minmax(250px,310px) minmax(0,1fr); gap:22px; align-items:start; }
  .countdown-creator { padding-bottom:18px; }
  .countdown-form { display:flex; flex-direction:column; gap:16px; padding:0 18px; }
  .countdown-form label, .countdown-form fieldset { display:flex; flex-direction:column; gap:7px; margin:0; border:0; padding:0; }
  .countdown-form label > span, .countdown-form legend { color:var(--ink-soft); font-size:.76rem; font-weight:700; }
  .countdown-form input { width:100%; border:1px solid var(--line); border-radius:8px; padding:10px 11px; background:var(--surface-subtle); color:var(--ink); outline:none; }
  .countdown-form input:focus { border-color:var(--accent); box-shadow:0 0 0 3px rgba(7,143,131,.12); }
  .duration-inputs { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; }
  .duration-inputs label > span { font-size:.68rem; font-weight:600; color:var(--ink-muted); }
  .create-button { width:100%; margin-top:2px; }
  .countdown-error { margin:0; color:var(--danger); font-size:.76rem; }
  .countdown-list { display:flex; flex-direction:column; gap:14px; min-width:0; }
  .countdown-empty { min-height:180px; display:grid; place-items:center; }
  .countdown-card { padding:20px; }
  .countdown-card-main { display:flex; align-items:center; gap:24px; }
  .countdown-ring-wrap { position:relative; flex:0 0 142px; width:142px; height:142px; }
  .countdown-ring { width:142px; height:142px; transform:rotate(-90deg); overflow:visible; }
  .ring-track, .ring-progress { fill:none; stroke-width:8; }
  .ring-track { stroke:#e4eeea; }
  .ring-progress { stroke:var(--accent); stroke-linecap:round; transition:stroke-dashoffset .4s ease; }
  .ring-content { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; }
  .ring-content strong { color:var(--ink); font-size:1.05rem; letter-spacing:.02em; }
  .ring-content span { color:var(--ink-muted); font-size:.66rem; }
  .countdown-copy { min-width:0; flex:1; }
  .countdown-title-row { display:flex; align-items:center; gap:10px; min-width:0; }
  .countdown-title-row h2 { overflow:hidden; margin:0; color:var(--ink); font-size:1.05rem; text-overflow:ellipsis; white-space:nowrap; }
  .countdown-status { flex:0 0 auto; border-radius:999px; padding:4px 7px; background:var(--surface-tint); color:var(--accent-strong); font-size:.65rem; font-weight:700; }
  .countdown-status.completed { background:#edf7f1; color:var(--success); }
  .countdown-copy > p { margin:8px 0 16px; color:var(--ink-muted); font-size:.76rem; }
  .countdown-actions { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
  .text-action { border:0; background:transparent; padding:9px 6px; color:var(--ink-muted); font-size:.76rem; font-weight:700; }
  .text-action:hover { color:var(--ink); }
  .danger-action:hover { color:var(--danger); }
  @media (max-width:760px) { .countdown-layout { grid-template-columns:1fr; } .countdown-card-main { align-items:flex-start; } }
</style>
