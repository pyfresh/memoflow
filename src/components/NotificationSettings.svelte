<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { NotificationSettings } from '$lib/domain/types';

  export let settings: NotificationSettings = { pushplusEnabled: false, pushplusToken: '' };
  export let onSave: (settings: NotificationSettings) => void = () => {};
  export let onCancel: () => void = () => {};
  export let onTest: (token: string) => Promise<void> = async () => {};

  const dispatch = createEventDispatcher<{ save: NotificationSettings; cancel: void; test: string }>();
  let enabled = settings.pushplusEnabled;
  let token = settings.pushplusToken;
  let status = '';
  let testing = false;

  function save() {
    if (enabled && !token.trim()) {
      status = '请输入 PushPlus Token';
      return;
    }
    const next = { pushplusEnabled: enabled, pushplusToken: token.trim() };
    onSave(next);
    dispatch('save', next);
  }

  async function testSend() {
    if (!token.trim()) {
      status = '请输入 PushPlus Token';
      return;
    }
    testing = true;
    status = '';
    try {
      await onTest(token.trim());
      dispatch('test', token.trim());
      status = '测试提醒已发送';
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    } finally {
      testing = false;
    }
  }
</script>

<form class="settings-form" on:submit|preventDefault={save}>
  <div class="settings-heading">
    <div>
      <p class="eyebrow">通知渠道</p>
      <h2>PushPlus 微信提醒</h2>
      <p class="description">提醒到期时，通过 PushPlus 服务号发送一条微信消息。本机通知始终保留。</p>
    </div>
    <button class="close-button" type="button" aria-label="关闭通知设置" on:click={onCancel}>×</button>
  </div>

  <label class="toggle-row">
    <input type="checkbox" aria-label="启用 PushPlus 微信提醒" bind:checked={enabled} />
    <span>
      <strong>启用 PushPlus</strong>
      <small>{enabled ? '已启用外部提醒' : '当前仅使用本机通知'}</small>
    </span>
  </label>

  <label class="field">
    <span>PushPlus Token</span>
    <input aria-label="PushPlus Token" type="password" autocomplete="off" bind:value={token} placeholder="粘贴 PushPlus Token" />
  </label>

  <p class="hint">Token 只保存在本机应用数据中，不会写入日志或导出文件。</p>
  {#if status}<p class="status" role="status" aria-live="polite">{status}</p>{/if}

  <div class="actions">
    <button class="secondary" type="button" disabled={testing} on:click={testSend}>{testing ? '发送中…' : '发送测试提醒'}</button>
    <div class="spacer"></div>
    <button class="secondary" type="button" on:click={onCancel}>取消</button>
    <button class="primary" type="submit">保存通知设置</button>
  </div>
</form>

<style>
  .settings-form { display:flex; flex-direction:column; gap:18px; }
  .settings-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; }
  .eyebrow { margin:0 0 5px; color:var(--accent); font-size:.7rem; font-weight:750; letter-spacing:.12em; text-transform:uppercase; }
  h2 { margin:0; color:var(--ink); font-size:1.45rem; letter-spacing:-.035em; }
  .description { max-width:470px; margin:8px 0 0; color:var(--ink-soft); font-size:.8rem; line-height:1.55; }
  .close-button { display:grid; place-items:center; width:42px; height:42px; border:1px solid var(--line); border-radius:8px; background:var(--surface); color:var(--ink-soft); font-size:1.25rem; line-height:1; cursor:pointer; }
  .close-button:hover { border-color:var(--accent); color:var(--accent); background:var(--surface-tint); }
  .toggle-row { display:flex; flex-direction:row; align-items:center; gap:11px; border:1px solid var(--line); border-radius:8px; padding:13px 14px; background:var(--surface-subtle); color:var(--ink); cursor:pointer; }
  .toggle-row input { width:17px; height:17px; accent-color:var(--accent); }
  .toggle-row span { display:flex; flex-direction:column; gap:3px; }
  .toggle-row strong { font-size:.86rem; }
  .toggle-row small { color:var(--ink-muted); font-size:.73rem; font-weight:500; }
  .field { display:flex; flex-direction:column; gap:7px; color:var(--ink-soft); font-size:.8rem; font-weight:650; }
  .field input { box-sizing:border-box; width:100%; border:1px solid var(--line); border-radius:8px; padding:11px 12px; background:var(--surface); color:var(--ink); font:inherit; font-weight:400; outline:0; }
  .field input:focus { border-color:var(--accent); box-shadow:0 0 0 3px rgba(7,143,131,.12); }
  .hint { margin:-8px 0 0; color:var(--ink-muted); font-size:.72rem; line-height:1.5; }
  .status { margin:-4px 0 0; color:var(--accent-strong); font-size:.78rem; font-weight:650; }
  .actions { display:flex; align-items:center; gap:8px; }
  .spacer { flex:1; }
  .primary, .secondary { border-radius:8px; padding:10px 14px; font:inherit; font-size:.8rem; font-weight:750; cursor:pointer; }
  .primary { border:0; background:var(--accent); color:#fff; box-shadow:0 6px 16px rgba(7,143,131,.2); }
  .primary:hover { background:var(--accent-strong); }
  .secondary { border:1px solid var(--line); background:var(--surface); color:var(--ink-soft); }
  .secondary:hover:not(:disabled) { border-color:var(--accent); color:var(--accent-strong); background:var(--surface-tint); }
  .secondary:disabled { cursor:wait; opacity:.65; }
</style>
