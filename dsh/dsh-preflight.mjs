// @ts-nocheck
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost'])
const ACCEPTED_BRIDGE_PHASES = new Set(['idle', 'ready', 'running', 'wait', 'wait-credentials', 'paired'])

function fail(message) {
  throw new Error(`DSH preflight failed: ${message}`)
}

function parseJsonResponse(response, label) {
  if (!response || typeof response.ok !== 'boolean' || !response.ok) {
    fail(`${label} HTTP ${response?.status ?? 'unknown'}`)
  }
  return response.json().catch(() => fail(`${label} returned invalid JSON`))
}

function bridgeUrl(value) {
  let url
  try { url = new URL(value) } catch { fail('bridgeBaseUrl is not a valid URL') }
  if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) fail('bridgeBaseUrl must use a loopback HTTP URL')
  if (!url.port) fail('bridgeBaseUrl must include the active bridge port')
  return url
}

function countEntries(value) {
  if (Array.isArray(value)) return value.length
  if (Number.isInteger(value) && value >= 0) return value
  return 0
}

/**
 * Resolve the MCP server without relying on a fixed drive letter. The override
 * is useful for the DSH desktop bridge and for isolated preflight tests.
 */
export function resolveMcpServerPath(env = process.env) {
  const override = typeof env.MEMOFLOW_MCP_SERVER === 'string' ? env.MEMOFLOW_MCP_SERVER.trim() : ''
  if (override) return isAbsolute(override) ? override : resolve(override)
  const home = env.USERPROFILE || env.HOME || homedir()
  return join(home, '.dsh', 'memoflow', 'memoflow-mcp-server.mjs')
}

/**
 * Inspect the project preset statically. ClawBot/iLink is the transport
 * owned by wxbridge; it must never appear as an Agent or MCP entry here.
 */
export function inspectMemoflowPreset(text) {
  if (typeof text !== 'string' || !text.trim()) fail('MemoFlow preset is empty')
  const entries = [...text.matchAll(/^\s*-\s+id:\s*([^\s#]+)\s*$/gm)].map((match) => match[1])
  if (entries.length === 0) fail('MemoFlow preset has no plugin entries')
  if (entries.some((entry) => entry === 'tool-ask-user')) fail('MemoFlow preset contains the interactive ask-user tool')
  if (!entries.includes('persona') || !entries.includes('memoflow-mcp')) fail('MemoFlow preset must include persona and memoflow-mcp')
  const clawbotEntries = entries.filter((entry) => /clawbot|ilink|wxbridge/i.test(entry))
  if (clawbotEntries.length) fail(`ClawBot transport must remain outside the Agent/MCP preset: ${clawbotEntries.join(', ')}`)
  return {
    entries,
    selected: 'memoflow',
    mcpServerEnv: /MEMOFLOW_MCP_SERVER/.test(text),
    clawbotEntries,
  }
}

/**
 * Validate one ACP/MCP trace. The check is intentionally independent of DSH
 * logs so CI and the bridge self-test can reject duplicate calls reliably.
 */
export function validateToolCallTrace(calls) {
  if (!Array.isArray(calls)) fail('tool call trace must be an array')
  const unexpected = calls.filter((call) => call && call.name !== 'create_reminder')
  if (unexpected.length) fail(`unexpected tool calls in MemoFlow turn: ${unexpected.map((call) => call.name || '(unnamed)').join(', ')}`)
  const reminderCalls = calls.filter((call) => call && call.name === 'create_reminder')
  if (reminderCalls.length !== 1) fail(`create_reminder must be called exactly one time (got ${reminderCalls.length})`)
  const [call] = reminderCalls
  if (call.response?.status === 'needs_confirmation' && call.wrote === true) {
    fail('needs_confirmation must not write a memo or reminder')
  }
  return { ok: true }
}

async function getJson(fetchImpl, url, label) {
  let response
  try { response = await fetchImpl(url, { method: 'GET' }) } catch (error) { fail(`${label} unavailable: ${error instanceof Error ? error.message : String(error)}`) }
  return parseJsonResponse(response, label)
}

/**
 * Run all side-effect-free checks required before a real微信 message test.
 * The MemoFlow probe deliberately supplies a date plus a time-of-day without
 * an HH:mm. The endpoint must return needs_confirmation, proving the bearer
 * token and request path work while proving no record is written.
 */
export async function runDshPreflight({
  bridgeBaseUrl,
  bridgePort,
  expectedBridgePort,
  inbound,
  presetText,
  mcpServerPath,
  fileExists = existsSync,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') fail('fetch implementation is unavailable')
  const base = bridgeUrl(bridgeBaseUrl)
  const actualPort = Number(base.port)
  if (bridgePort !== undefined && bridgePort !== actualPort) fail(`bridge port mismatch: URL=${actualPort}, configured=${bridgePort}`)
  if (expectedBridgePort !== undefined && expectedBridgePort !== actualPort) fail(`bridge port mismatch: URL=${actualPort}, expected=${expectedBridgePort}`)

  const presetInfo = inspectMemoflowPreset(presetText)
  if (!presetInfo.mcpServerEnv) fail('MCP server path must support MEMOFLOW_MCP_SERVER')
  if (typeof mcpServerPath !== 'string' || !mcpServerPath.trim() || !fileExists(mcpServerPath)) fail(`MCP server is missing: ${mcpServerPath || '(empty)'}`)

  const status = await getJson(fetchImpl, `${base.origin}/wxbridge/status`, 'wxbridge status')
  const bridgeStatus = status?.bridge ?? status
  const phase = bridgeStatus?.phase
  if (!ACCEPTED_BRIDGE_PHASES.has(phase)) fail(`wxbridge phase is not ready: ${phase ?? '(missing)'}`)
  if (countEntries(status?.peers ?? bridgeStatus?.peers) < 1) fail('wxbridge has no paired peer')
  if (countEntries(status?.allowedUsers ?? bridgeStatus?.allowedUsers) < 1) fail('wxbridge allowlist is empty')
  const bridgeFlags = ['pidOk', 'fresh', 'stateOk', 'runtimeBinOk']
  const failedFlag = bridgeFlags.find((key) => bridgeStatus?.[key] === false)
  if (failedFlag) fail(`wxbridge ${failedFlag}=false`)

  const presets = await getJson(fetchImpl, `${base.origin}/wxbridge/presets`, 'wxbridge presets')
  if (presets?.selected !== 'memoflow') fail(`wxbridge selected=${presets?.selected ?? '(missing)'}, expected selected=memoflow`)

  if (!inbound || !LOOPBACK_HOSTS.has(String(inbound.host).trim().toLowerCase())) fail('MemoFlow inbound host must be loopback')
  if (!Number.isInteger(inbound.port) || inbound.port < 1 || inbound.port > 65535) fail('MemoFlow inbound port is invalid')
  if (typeof inbound.token !== 'string' || !inbound.token.trim()) fail('MemoFlow inbound bearer token is missing')
  const inboundBase = `http://${inbound.host}:${inbound.port}`
  const healthPath = typeof inbound.healthPath === 'string' && /^\/[A-Za-z0-9/_-]+$/.test(inbound.healthPath) ? inbound.healthPath : '/api/dsh/health'
  let healthResponse
  try {
    healthResponse = await fetchImpl(`${inboundBase}${healthPath}`, { method: 'GET', headers: { authorization: `Bearer ${inbound.token}` } })
  } catch (error) { fail(`MemoFlow inbound health unavailable: ${error instanceof Error ? error.message : String(error)}`) }
  const healthPayload = await parseJsonResponse(healthResponse, 'MemoFlow inbound health')
  if (healthPayload?.status !== 'ok' || healthPayload?.service !== 'memoflow-inbound' || healthPayload?.port !== inbound.port) fail('MemoFlow inbound health check did not describe the active process')

  const inboundUrl = `${inboundBase}/api/dsh/tools/create-reminder`
  let inboundResponse
  try {
    inboundResponse = await fetchImpl(inboundUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${inbound.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ title: '__memoflow_preflight__', body: 'DSH preflight', date: '2099-01-01', timeOfDay: 'afternoon', source: 'dsh' }),
    })
  } catch (error) { fail(`MemoFlow inbound unavailable: ${error instanceof Error ? error.message : String(error)}`) }
  const inboundPayload = await parseJsonResponse(inboundResponse, 'MemoFlow inbound')
  if (inboundPayload?.status !== 'needs_confirmation') fail(`MemoFlow inbound probe must return needs_confirmation (got ${inboundPayload?.status ?? '(missing)'})`)
  return { ok: true, selectedPreset: presets.selected, bridgePort: actualPort, inbound: 'needs_confirmation' }
}

