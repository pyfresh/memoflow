// @ts-nocheck
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inspectMemoflowPreset, runDshPreflight, validateToolCallTrace } from '../../dsh/dsh-preflight.mjs';

const preset = `
- id: persona
  name: '@deepseek-ai/dsh-persona'
- id: memoflow-mcp
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    command: !!js process.execPath
    args:
      - !!js 'process.env.MEMOFLOW_MCP_SERVER || process.env.USERPROFILE + "/.dsh/memoflow/memoflow-mcp-server.mjs"'
`;

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

describe('DSH MemoFlow preflight', () => {
  it('keeps the checked-in preset selectable and environment-overridable', () => {
    const checkedIn = readFileSync(resolve(process.cwd(), 'dsh/memoflow-agent-preset/agent.cordis.yml'), 'utf8');
    expect(inspectMemoflowPreset(checkedIn)).toEqual(expect.objectContaining({ selected: 'memoflow', mcpServerEnv: true, clawbotEntries: [] }));
  });

  it('accepts the isolated MemoFlow preset and rejects ClawBot as an agent tool', () => {
    expect(inspectMemoflowPreset(preset)).toEqual({
      entries: ['persona', 'memoflow-mcp'],
      selected: 'memoflow',
      mcpServerEnv: true,
      clawbotEntries: [],
    });
  });

  it('checks the bridge, selected preset and bearer-protected no-write request', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/wxbridge/status')) return jsonResponse({ bridge: { phase: 'idle', peers: 1, allowedUsers: 1, pidOk: true, fresh: true, stateOk: true, runtimeBinOk: true }, peers: 1 });
      if (url.endsWith('/wxbridge/presets')) return jsonResponse({ selected: 'memoflow' });
      if (url.endsWith('/api/dsh/health')) return jsonResponse({ status: 'ok', service: 'memoflow-inbound', port: 45678 });
      expect(url).toBe('http://127.0.0.1:45678/api/dsh/tools/create-reminder');
      expect(init?.headers).toEqual({ authorization: 'Bearer test-token', 'content-type': 'application/json' });
      expect(JSON.parse(String(init?.body))).toMatchObject({ title: '__memoflow_preflight__', timeOfDay: 'afternoon', source: 'dsh' });
      return jsonResponse({ status: 'needs_confirmation' });
    });

    await expect(runDshPreflight({
      bridgeBaseUrl: 'http://127.0.0.1:7768',
      bridgePort: 7768,
      expectedBridgePort: 7768,
      inbound: { host: '127.0.0.1', port: 45678, token: 'test-token', healthPath: '/api/dsh/health' },
      presetText: preset,
      mcpServerPath: 'C:/Users/test/.dsh/memoflow/memoflow-mcp-server.mjs',
      fileExists: () => true,
      fetchImpl,
    })).resolves.toEqual(expect.objectContaining({ ok: true, selectedPreset: 'memoflow' }));
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('reports a selected preset mismatch before a real message is sent', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/wxbridge/status')) return jsonResponse({ bridge: { phase: 'idle', peers: 1, allowedUsers: 1 }, peers: 1 });
      return jsonResponse({ selected: 'default' });
    });
    await expect(runDshPreflight({
      bridgeBaseUrl: 'http://127.0.0.1:7768', bridgePort: 7768, expectedBridgePort: 7768,
      inbound: { host: '127.0.0.1', port: 45678, token: 'test-token', healthPath: '/api/dsh/health' }, presetText: preset,
      mcpServerPath: 'server.mjs', fileExists: () => true, fetchImpl,
    })).rejects.toThrow('selected=memoflow');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects a missing MCP server when no custom file checker is supplied', async () => {
    await expect(runDshPreflight({
      bridgeBaseUrl: 'http://127.0.0.1:7768', bridgePort: 7768, expectedBridgePort: 7768,
      inbound: { host: '127.0.0.1', port: 45678, token: 'test-token' }, presetText: preset,
      mcpServerPath: 'C:/path/that/does/not/exist/memoflow-mcp-server.mjs',
    })).rejects.toThrow('MCP server is missing');
  });

  it('requires exactly one create_reminder call and forbids writes after needs_confirmation', () => {
    expect(validateToolCallTrace([{ name: 'create_reminder', response: { status: 'needs_confirmation' } }])).toEqual({ ok: true });
    expect(() => validateToolCallTrace([
      { name: 'pwsh', response: { status: 'ok' } },
      { name: 'create_reminder', response: { status: 'created' } },
    ])).toThrow('unexpected');
    expect(() => validateToolCallTrace([
      { name: 'create_reminder', response: { status: 'needs_confirmation' } },
      { name: 'create_reminder', response: { status: 'created' } },
    ])).toThrow('exactly one');
    expect(() => validateToolCallTrace([
      { name: 'create_reminder', response: { status: 'needs_confirmation' }, wrote: true },
    ])).toThrow('must not write');
  });
});
