import type { RealtimeFunction } from '../realtime/session.ts';

/** What a running tool can do besides return a result. */
export interface ToolContext {
  /** Put something on the caller's screen (`display` tool arguments). */
  display(args: unknown): void;
}

/** A tool the gateway runs on the voice model's behalf. Arguments arrive as parsed JSON. */
export interface GatewayTool {
  definition: RealtimeFunction;
  run(args: unknown, context: ToolContext): Promise<unknown>;
}

const NO_CONTEXT: ToolContext = { display: () => {} };

/**
 * Tools the voice session can call through the gateway: live data now; delegate, memory,
 * jobs and settings from M4 on. (`display` and `screen` run in the page itself.)
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
  async call(name: string, rawArgs: string, context: ToolContext = NO_CONTEXT): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) return JSON.stringify({ error: `Unknown tool: ${name}` });
    let args: unknown;
    try {
      args = rawArgs ? JSON.parse(rawArgs) : {};
    } catch {
      return JSON.stringify({ error: 'Arguments were not valid JSON' });
    }
    try {
      return JSON.stringify((await tool.run(args, context)) ?? { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[tools] ${name} failed: ${message}`);
      return JSON.stringify({ error: message });
    }
  }
}
