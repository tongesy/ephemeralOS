import { loadConfig } from './config.ts';
import { startGateway } from './server.ts';

const config = loadConfig();
const gateway = await startGateway(config);

console.log(`ephemeralOS gateway listening on http://${config.host}:${gateway.port}`);
if (config.webRoot) console.log(`Open http://localhost:${gateway.port} in Chrome.`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void gateway.close().then(() => process.exit(0));
  });
}
