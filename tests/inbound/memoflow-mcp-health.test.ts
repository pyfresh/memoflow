// @ts-nocheck
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function rpc(process: ReturnType<typeof spawn>, id: number, method: string, params?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`RPC timeout for ${method}`)), 5000);
    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const line = buffer.split(/\r?\n/)[0];
      if (!line) return;
      clearTimeout(timer);
      process.stdout?.removeListener('data', onData);
      try { resolve(JSON.parse(line)); } catch (error) { reject(error); }
    };
    process.stdout?.on('data', onData);
    process.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`);
  });
}

describe('MemoFlow MCP health guard', () => {
  it('checks the live MemoFlow process before create_reminder', async () => {
    const paths: string[] = [];
    const server = createServer((request, response) => {
      paths.push(request.url ?? '');
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        response.setHeader('content-type', 'application/json');
        if (request.url === '/api/dsh/health') {
          response.end(JSON.stringify({ status: 'ok', service: 'memoflow-inbound', version: 1, pid: process.pid, port: address?.port }));
          return;
        }
        response.end(JSON.stringify({ status: 'needs_confirmation', title: '考试' }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    const temp = await mkdtemp(join(tmpdir(), 'memoflow-mcp-health-'));
    const configPath = join(temp, 'dsh-inbound.json');
    await writeFile(configPath, JSON.stringify({ version: 1, host: '127.0.0.1', port: address.port, token: 'test-token', pid: process.pid, startedAt: new Date().toISOString(), healthPath: '/api/dsh/health' }));
    const child = spawn(process.execPath, ['dsh/memoflow-mcp-server.mjs'], {
      cwd: process.cwd(),
      env: { ...process.env, MEMOFLOW_INBOUND_CONFIG: configPath },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    try {
      await rpc(child, 1, 'initialize', { protocolVersion: '2024-11-05' });
      const result = await rpc(child, 2, 'tools/call', { name: 'create_reminder', arguments: { title: '考试', date: '2099-01-01', timeOfDay: 'afternoon', source: 'dsh' } });
      expect(result.result.content[0].text).toContain('needs_confirmation');
      expect(paths).toEqual(['/api/dsh/health', '/api/dsh/tools/create-reminder']);
    } finally {
      child.kill();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(temp, { recursive: true, force: true });
    }
  });
});
