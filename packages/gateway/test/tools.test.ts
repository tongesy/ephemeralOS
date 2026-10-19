import { describe, expect, it, vi } from 'vitest';
import { ToolRegistry } from '../src/tools/registry.ts';

describe('ToolRegistry', () => {
  it('reports a failed fetch with its network cause', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tools = new ToolRegistry();
    tools.register({
      definition: { type: 'function', name: 'flaky', description: '', parameters: {} },
      run: () =>
        Promise.reject(
          new TypeError('fetch failed', {
            cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }),
          }),
        ),
    });
    expect(JSON.parse(await tools.call('flaky', '{}'))).toEqual({
      error: 'fetch failed (ENOTFOUND)',
    });
    expect(JSON.parse(await tools.call('missing', '{}'))).toEqual({
      error: 'Unknown tool: missing',
    });
  });
});
