#!/usr/bin/env node

import { createInterface } from 'node:readline'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const defaultConfigPath = join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'com.pyfresh.memoflow', 'dsh-inbound.json')
const configPath = resolve(process.env.MEMOFLOW_INBOUND_CONFIG?.trim() || defaultConfigPath)

class MemoFlowToolError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'MemoFlowToolError'
    this.code = code
  }
}

function reply(id, result, error) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, ...(error ? { error } : { result }) })}\n`)
}

async function callMemoFlow(argumentsValue) {
  if (!argumentsValue || typeof argumentsValue !== 'object' || Array.isArray(argumentsValue)) throw new MemoFlowToolError('invalid_arguments', '工具参数必须是对象')
  let serialized
  try {
    serialized = await readFile(configPath, 'utf8')
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN'
    if (code === 'ENOENT') {
      throw new MemoFlowToolError('config_missing', `MemoFlow 入站配置不存在：${configPath}。请先启动或重启新版 MemoFlow。`)
    }
    if (code === 'EACCES' || code === 'EPERM') {
      throw new MemoFlowToolError('config_unreadable', `MemoFlow 入站配置无法读取：${configPath}。请确认应用数据目录可读，然后重启 MemoFlow。`)
    }
    throw new MemoFlowToolError('config_read_failed', `MemoFlow 入站配置读取失败：${configPath}（${code}）。请重启 MemoFlow 后重试。`)
  }

  let config
  try {
    config = JSON.parse(serialized)
  } catch {
    throw new MemoFlowToolError('config_invalid_json', `MemoFlow 入站配置格式无效：${configPath}。请重启 MemoFlow 以重新生成配置。`)
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || config.version !== 1
    || config.host !== '127.0.0.1'
    || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535
    || typeof config.token !== 'string' || !config.token.trim()
    || !Number.isInteger(config.pid) || config.pid < 1
    || typeof config.startedAt !== 'string' || !config.startedAt.trim()
    || typeof config.healthPath !== 'string' || !/^\/[A-Za-z0-9/_-]+$/.test(config.healthPath)) {
    throw new MemoFlowToolError('config_invalid', `MemoFlow 入站配置无效：${configPath}。请重启 MemoFlow 以重新生成配置。`)
  }

  const baseUrl = `http://${config.host}:${config.port}`
  let healthResponse
  try {
    healthResponse = await fetch(`${baseUrl}${config.healthPath}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${config.token}` },
    })
  } catch {
    throw new MemoFlowToolError('connection_failed', `无法连接 MemoFlow 本地工具（${config.host}:${config.port}）。请先启动或重启 MemoFlow，然后重试。`)
  }
  let healthPayload
  try {
    healthPayload = await healthResponse.json()
  } catch {
    throw new MemoFlowToolError('health_check_failed', `MemoFlow 本地服务健康检查返回了无效响应（HTTP ${healthResponse.status}）。请重启 MemoFlow 后重试。`)
  }
  if (!healthResponse.ok || !healthPayload || healthPayload.status !== 'ok' || healthPayload.service !== 'memoflow-inbound' || healthPayload.pid !== config.pid || healthPayload.port !== config.port) {
    throw new MemoFlowToolError('health_check_failed', `MemoFlow 本地服务健康检查未通过（HTTP ${healthResponse.status}）。请重启 MemoFlow 后重试。`)
  }

  let response
  try {
    response = await fetch(`${baseUrl}/api/dsh/tools/create-reminder`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.token}` },
      body: JSON.stringify(argumentsValue),
    })
  } catch {
    throw new MemoFlowToolError('connection_failed', `无法连接 MemoFlow 本地工具（${config.host}:${config.port}）。请先启动或重启 MemoFlow，然后重试。`)
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    throw new MemoFlowToolError('invalid_response', `MemoFlow 本地工具返回了无效响应（HTTP ${response.status}，${config.host}:${config.port}）。请重启 MemoFlow 后重试。`)
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new MemoFlowToolError('invalid_response', `MemoFlow 本地工具返回了无效响应（HTTP ${response.status}，${config.host}:${config.port}）。请重启 MemoFlow 后重试。`)
  }
  return { payload, failed: !response.ok || payload.status === 'error' }
}

const tool = {
  name: 'create_reminder',
  description: '在 MemoFlow 中创建或更新一个提醒。仅支持结构化标题、原始描述、日期、具体时间、时段、重复规则和外部 id；缺少具体时间时返回 needs_confirmation，不会写入伪造的小时。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string', description: '事项名称' },
      body: { type: 'string', description: '用户原始描述' },
      date: { type: 'string', description: 'YYYY-MM-DD，使用 Asia/Hong_Kong' },
      time: { type: 'string', description: 'HH:mm，必须是具体时刻' },
      timeOfDay: { type: 'string', enum: ['morning', 'afternoon', 'evening', 'night'] },
      dueAt: { type: 'string', description: '可选 ISO 8601 日期时间；与 date/time 二选一' },
      recurrenceRule: { type: ['string', 'null'] },
      externalId: { type: ['string', 'null'] },
      source: { type: 'string', enum: ['dsh', 'manual'] },
    },
    required: ['title'],
  },
}

const input = createInterface({ input: process.stdin })
input.on('line', async (line) => {
  if (!line.trim()) return
  let message
  try { message = JSON.parse(line) } catch { return }
  if (message.method === 'notifications/initialized') return
  if (message.method === 'initialize') {
    reply(message.id, { protocolVersion: '2024-11-05', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'memoflow', version: '1.0.0' } })
    return
  }
  if (message.method === 'ping') { reply(message.id, {}); return }
  if (message.method === 'tools/list') { reply(message.id, { tools: [tool] }); return }
  if (message.method === 'tools/call') {
    if (message.params?.name !== tool.name) { reply(message.id, null, { code: -32602, message: '未知 MemoFlow 工具' }); return }
    try {
      const { payload, failed } = await callMemoFlow(message.params.arguments)
      reply(message.id, { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: failed })
    } catch (error) {
      const code = error instanceof MemoFlowToolError ? error.code : 'unknown_error'
      const text = error instanceof Error ? error.message : String(error)
      reply(message.id, { content: [{ type: 'text', text: JSON.stringify({ status: 'error', code, message: text }) }], isError: true })
    }
  }
})

