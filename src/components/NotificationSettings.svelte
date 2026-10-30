<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { NotificationSettings } from '$lib/domain/types';
  import type { DshPreflightResult } from '$lib/notifications/dsh';

  type DshTestSettings = { port: number; peerId: string };

  export let settings: NotificationSettings = {
    pushplusEnabled: false,
    pushplusToken: '',
    dshEnabled: false,
    dshPort: 7239,
    dshPeerId: '',
  };
  export let onSave: (settings: NotificationSettings) => void = () => {};
  export let onCancel: () => void = () => {};
  export let onTest: (token: string) => Promise<void> = async () => {};
  export let onTestDsh: (settings: DshTestSettings) => Promise<{ file?: string } | void> = async () => {};
  export let onCheckDsh: () => Promise<DshPreflightResult> = async () => ({ ok: false, port: null, message: '未执行检查', checks: [] });

  const dispatch = createEventDispatcher<{
    save: NotificationSettings;
    cancel: void;
    test: string;
    testDsh: DshTestSettings;
  }>();

  const hasDshFields = settings.dshEnabled !== undefined || settings.dshPort !== undefined || settings.dshPeerId !== undefined;
  let dshEnabled = settings.dshEnabled === true;
  let dshPort = settings.dshPort ?? 7239;
  let dshPeerId = settings.dshPeerId ?? '';
  let pushplusEnabled = settings.pushplusEnabled === true;
  let pushplusToken = settings.pushplusToken ?? '';
  let status = '';
  let testingDsh = false;
  let checkingDsh = false;
  let testingPushplus = false;
  let dshPreflight: DshPreflightResult | null = null;

  function buildSettings(): NotificationSettings {
    const next: NotificationSettings = {
      pushplusEnabled,
      pushplusToken: pushplusToken.trim(),
    };
    // Preserve the old shape for legacy callers, while the app passes DSH fields.
    if (hasDshFields || dshEnabled || dshPort !== 7239 || dshPeerId.trim()) {
      next.dshEnabled = dshEnabled;
      next.dshPort = Number(dshPort);
      next.dshPeerId = dshPeerId.trim();
    }
    return next;
  }

  function save() {
    if (dshEnabled && (!Number.isInteger(Number(dshPort)) || Number(dshPort) < 1 || Number(dshPort) > 65535)) {
      status = '请输入有效的 DSH 端口（1–65535）';
      return;
    }
    if (pushplusEnabled && !pushplusToken.trim()) {
      status = '请输入 PushPlus Token';
      return;
    }
    const next = buildSettings();
    onSave(next);
    dispatch('save', next);
    status = '通知设置已保存';
  }

  async function testDsh() {
    if (!Number.isInteger(Number(dshPort)) || Number(dshPort) < 1 || Number(dshPort) > 65535) {
      status = '请输入有效的 DSH 端口（1–65535）';
      return;
    }
    testingDsh = true;
    status = '';
    const testSettings = { port: Number(dshPort), peerId: dshPeerId.trim() };
    try {
      const result = await onTestDsh(testSettings);
      dispatch('testDsh', testSettings);
      status = result?.file
        ? '测试消息已加入微信桥发送队列，请在微信中确认是否收到。'
        : '测试消息已提交，请在微信中确认是否收到。';
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    } finally {
      testingDsh = false;
    }
  }

  async function checkDsh() {
    checkingDsh = true;
    status = '';
    try {
      dshPreflight = await onCheckDsh();
      const failed = dshPreflight.checks.filter((check) => !check.ok);
      status = dshPreflight.ok
        ? `DSH 链路检查通过，实际端口：${dshPreflight.port ?? '未知'}`
        : `DSH 链路检查未通过${failed.length ? `：${failed.map((check) => `${check.name}：${check.detail}`).join('；')}` : ''}`;
    } catch (error) {
      dshPreflight = null;
      status = error instanceof Error ? error.message : String(error);
    } finally {
      checkingDsh = false;
    }
  }

  async function testPushplus() {
    if (!pushplusToken.trim()) {
      status = '请输入 PushPlus Token';
      return;
    }
    testingPushplus = true;
    status = '';
    try {
      await onTest(pushplusToken.trim());
      dispatch('test', pushplusToken.trim());
      status = 'PushPlus 测试提醒已发送';
    } catch (error) {
      status = error instanceof Error ? error.message : String(error);
    } finally {
      testingPushplus = false;
    }
  }
</script>

<form class="settings-form" on:submit|preventDefault={save}>
  <div class="settings-heading">
    <div>
      <p class="eyebrow">通知渠道</p>
      <h2>微信提醒</h2>
      <p class="description">通过本机 DSH 微信桥接发送提醒。桥接只监听本机回环地址，不需要把微信凭据交给 MemoFlow。</p>
    </div>
    <button class="close-button" type="button" aria-label="关闭通知设置" on:click={onCancel}>×</button>
  </div>

  <section class="channel-card dsh-card" aria-label="DSH 微信桥接">
    <div class="channel-heading">
      <div>
        <h3>DSH 微信桥接</h3>
        <p>适合个人使用。DSH 桌面端运行后，消息会先进入本机队列，再由已配对的微信发送。</p>
      </div>
      <label class="switch" aria-label="启用 DSH 微信桥接">
        <input type="checkbox" bind:checked={dshEnabled} />
        <span aria-hidden="true"></span>
      </label>
    </div>

    <div class="fields-row">
      <label class="field compact">
        <span>桥接端口</span>
        <input aria-label="DSH 端口" type="number" min="1" max="65535" step="1" bind:value={dshPort} />
      </label>
      <label class="field peer-field">
        <span>接收方 ID（可选）</span>
        <input aria-label="DSH 接收方 ID" type="text" autocomplete="off" bind:value={dshPeerId} placeholder="留空使用当前配对会话" />
      </label>
    </div>
    <p class="hint">端口 7239 仅作兼容回退，桌面端会优先发现 DSH 的动态端口。请先完成微信配对；测试消息只有进入 sent 后才算桥接发送成功，手机显示仍需人工确认。</p>
    <div class="dsh-actions">
      <button class="secondary test-button" type="button" disabled={checkingDsh || testingDsh || testingPushplus} on:click={checkDsh}>{checkingDsh ? '检查中…' : '检测 DSH 链路'}</button>
      <button class="secondary test-button" type="button" disabled={checkingDsh || testingDsh || testingPushplus} on:click={testDsh}>{testingDsh ? '提交中…' : '发送 DSH 测试消息'}</button>
    </div>
    {#if dshPreflight}
      <ul class="preflight-list" aria-label="DSH 链路检查结果">
        {#each dshPreflight.checks as check}
          <li class:check-ok={check.ok} class:check-failed={!check.ok}><span aria-hidden="true">{check.ok ? '✓' : '!'}</span><span>{check.name}：{check.detail}</span></li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="channel-card fallback-card" aria-label="PushPlus 备用通知">
    <div class="channel-heading">
      <div>
        <h3>PushPlus 备用通知</h3>
        <p>DSH 不可用时可手动启用的备用渠道。本机通知始终保留。</p>
      </div>
      <label class="switch" aria-label="启用 PushPlus 微信提醒">
        <input type="checkbox" bind:checked={pushplusEnabled} />
        <span aria-hidden="true"></span>
      </label>
    </div>
    <label class="field">
      <span>PushPlus Token</span>
      <input aria-label="PushPlus Token" type="password" autocomplete="off" bind:value={pushplusToken} placeholder="粘贴 PushPlus Token" />
    </label>
    <button class="secondary test-button" aria-label="发送测试提醒" type="button" disabled={testingDsh || testingPushplus} on:click={testPushplus}>{testingPushplus ? '发送中…' : '发送 PushPlus 测试提醒'}</button>
  </section>

  <p class="hint">Token 和桥接参数只保存在本机应用数据中，不会写入日志或导出文件。</p>
  {#if status}<p class="status" role="status" aria-live="polite">{status}</p>{/if}

  <div class="actions">
    <div class="spacer"></div>
    <button class="secondary" type="button" on:click={onCancel}>取消</button>
    <button class="primary" type="submit">保存通知设置</button>
  </div>
</form>

<style>
  .settings-form { display:flex; flex-direction:column; gap:14px; }
  .settings-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; margin-bottom:2px; }
  .eyebrow { margin:0 0 5px; color:var(--accent); font-size:.7rem; font-weight:750; letter-spacing:.12em; text-transform:uppercase; }
  h2 { margin:0; color:var(--ink); font-size:1.45rem; letter-spacing:-.035em; }
  .description { max-width:500px; margin:8px 0 0; color:var(--ink-soft); font-size:.8rem; line-height:1.55; }
  .close-button { display:grid; place-items:center; width:42px; height:42px; border:1px solid var(--line); border-radius:8px; background:var(--surface); color:var(--ink-soft); font-size:1.25rem; line-height:1; cursor:pointer; }
  .close-button:hover { border-color:var(--accent); color:var(--accent); background:var(--surface-tint); }
  .channel-card { display:flex; flex-direction:column; gap:13px; border:1px solid var(--line); border-radius:10px; padding:15px; background:var(--surface-subtle); }
  .dsh-card { border-color:rgba(7,143,131,.3); background:linear-gradient(145deg, var(--surface-tint), var(--surface-subtle)); }
  .channel-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
  h3 { margin:0; color:var(--ink); font-size:.92rem; }
  .channel-heading p { max-width:490px; margin:5px 0 0; color:var(--ink-soft); font-size:.73rem; line-height:1.5; }
  .switch { position:relative; flex:0 0 auto; width:39px; height:22px; cursor:pointer; }
  .switch input { position:absolute; opacity:0; width:1px; height:1px; }
  .switch span { display:block; width:39px; height:22px; border-radius:999px; background:var(--line-strong, #b5bfbe); transition:background .15s ease; }
  .switch span::after { content:""; display:block; width:18px; height:18px; margin:2px; border-radius:50%; background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.18); transition:transform .15s ease; }
  .switch input:checked + span { background:var(--accent); }
  .switch input:checked + span::after { transform:translateX(17px); }
  .switch input:focus-visible + span { outline:3px solid rgba(7,143,131,.2); outline-offset:2px; }
  .fields-row { display:flex; gap:12px; }
  .peer-field { flex:1; }
  .compact { width:128px; }
  .field { display:flex; flex-direction:column; gap:6px; color:var(--ink-soft); font-size:.77rem; font-weight:650; }
  .field input { box-sizing:border-box; width:100%; border:1px solid var(--line); border-radius:7px; padding:9px 10px; background:var(--surface); color:var(--ink); font:inherit; font-weight:400; outline:0; }
  .field input:focus { border-color:var(--accent); box-shadow:0 0 0 3px rgba(7,143,131,.12); }
  .hint { margin:0; color:var(--ink-muted); font-size:.7rem; line-height:1.5; }
  .test-button { align-self:flex-start; }
  .dsh-actions { display:flex; flex-wrap:wrap; gap:8px; }
  .preflight-list { display:flex; flex-direction:column; gap:5px; margin:0; padding:0; list-style:none; color:var(--ink-muted); font-size:.7rem; line-height:1.4; }
  .preflight-list li { display:flex; align-items:flex-start; gap:6px; }
  .preflight-list li span:first-child { display:inline-grid; place-items:center; width:15px; height:15px; border-radius:50%; background:var(--line); color:var(--ink-soft); font-size:.64rem; font-weight:800; }
  .preflight-list .check-ok span:first-child { background:rgba(40,160,105,.14); color:#218552; }
  .preflight-list .check-failed span:first-child { background:rgba(196,72,73,.14); color:#b73f45; }
  .status { margin:0; color:var(--accent-strong); font-size:.78rem; font-weight:650; }
  .actions { display:flex; align-items:center; gap:8px; margin-top:2px; }
  .spacer { flex:1; }
  .primary, .secondary { border-radius:8px; padding:10px 14px; font:inherit; font-size:.8rem; font-weight:750; cursor:pointer; }
  .primary { border:0; background:var(--accent); color:#fff; box-shadow:0 6px 16px rgba(7,143,131,.2); }
  .primary:hover { background:var(--accent-strong); }
  .secondary { border:1px solid var(--line); background:var(--surface); color:var(--ink-soft); }
  .secondary:hover:not(:disabled) { border-color:var(--accent); color:var(--accent-strong); background:var(--surface-tint); }
  .secondary:disabled { cursor:wait; opacity:.65; }
  @media (max-width:560px) { .fields-row { flex-direction:column; } .compact { width:auto; } }
</style>
