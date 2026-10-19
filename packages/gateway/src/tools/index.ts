import { ToolRegistry } from './registry.ts';
import { createSearchTool } from './search.ts';
import { createWeatherTool } from './weather.ts';

/** The tools every gateway offers the voice session. */
export function defaultTools(options: { homeDir: string; fetch?: typeof fetch }): ToolRegistry {
  const tools = new ToolRegistry();
  tools.register(createWeatherTool(options));
  tools.register(createSearchTool(options));
  return tools;
}

export { ToolRegistry, type GatewayTool, type ToolContext } from './registry.ts';
