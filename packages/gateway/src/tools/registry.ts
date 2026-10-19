import type { RealtimeFunction } from '../realtime/session.ts';

/** A tool the gateway runs on the voice model's behalf. Arguments arrive as parsed JSON. */
export interface GatewayTool {
  definition: RealtimeFunction;
  run(args: unknown): Promise<unknown>;
}

/**
 * Tools the voice session can call through the gateway. Display, delegate, memory,
 * jobs and settings register here from M3 on.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, GatewayTool>();

  register(tool: GatewayTool): void {
    this.tools.set(tool.definition.name, tool);
  }

  definitions(): RealtimeFunction[] {
    return [...this.tools.values()].map((t) => t.definition);
  }

  /** Run a call and return the JSON string the model should see. Never throws. */
  async call(name: string, rawArgs: string): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) return JSON.stringify({ error: `Unknown tool: ${name}` });
    let args: unknown;
    try {
      args = rawArgs ? JSON.parse(rawArgs) : {};
    } catch {
      return JSON.stringify({ error: 'Arguments were not valid JSON' });
    }
    try {
      return JSON.stringify((await tool.run(args)) ?? { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return JSON.stringify({ error: message });
    }
  }
}
