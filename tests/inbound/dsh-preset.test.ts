import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const preset = readFileSync(resolve(process.cwd(), 'dsh/memoflow-agent-preset/agent.cordis.yml'), 'utf8');

describe('DSH MemoFlow time clarification policy', () => {
  it('ends an ambiguous time turn instead of waiting inside the session', () => {
    expect(preset).not.toMatch(/^- id: tool-ask-user\s*$/m);
    expect(preset).not.toMatch(/^- id: pwsh-sandbox\s*\n\s+disabled: true/m);
    expect(preset).not.toMatch(/^- id: tool-pwsh\s*\n\s+disabled: true/m);
    expect(preset).toContain('不要调用 ask_user');
    expect(preset).toContain('不要调用其他工具');
    expect(preset).toContain('不要等待用户回复');
    expect(preset).toContain('本轮结束');
    expect(preset).toContain('下一条消息');
  });
});
