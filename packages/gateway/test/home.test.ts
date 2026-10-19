import { describe, expect, it } from 'vitest';
import { Config } from '@ephemeralos/shared';
import { parseEnv } from '../src/home.ts';
import { buildInstructions } from '../src/realtime/instructions.ts';
import { ToolRegistry } from '../src/tools/registry.ts';

describe('parseEnv', () => {
  it('reads keys, skips comments and strips quotes', () => {
    expect(
      parseEnv('# keys\nOPENAI_API_KEY="sk-1"\nexport ANTHROPIC_API_KEY=\'sk-2\'\n\nBROKEN\n'),
    ).toEqual({ OPENAI_API_KEY: 'sk-1', ANTHROPIC_API_KEY: 'sk-2' });
  });
});

describe('buildInstructions', () => {
  it('names the agent, lists sleep phrases and appends persona sections', () => {
    const text = buildInstructions(Config.parse({ name: 'Nova' }), {
      soul: 'Warm.',
      user: '',
      memory: 'Lives in Oslo.',
    });
    expect(text).toContain('You are Nova');
    expect(text).toContain("that's all");
    expect(text).toContain('## Persona (SOUL.md)\n\nWarm.');
    expect(text).not.toContain('USER.md');
    expect(text).toContain('Lives in Oslo.');
  });
});

describe('ToolRegistry', () => {
  it('turns unknown tools, bad JSON and thrown errors into results', async () => {
    const tools = new ToolRegistry();
    tools.register({
      definition: { type: 'function', name: 'fail', description: '', parameters: {} },
      run: async () => {
        throw new Error('nope');
      },
    });
    expect(JSON.parse(await tools.call('missing', '{}'))).toHaveProperty('error');
    expect(JSON.parse(await tools.call('fail', '{bad'))).toHaveProperty('error');
    expect(JSON.parse(await tools.call('fail', '{}'))).toEqual({ error: 'nope' });
  });
});
