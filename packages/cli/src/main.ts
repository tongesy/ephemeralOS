import { argv, exit } from 'node:process';
import { init } from './init.ts';
import { closePrompts } from './prompt.ts';
import { start } from './start.ts';
import { resolveHome } from './paths.ts';

const USAGE = `ephemeralOS

Usage:
  ephemeralos init     Set up your home folder: API keys, persona, wake-word models
  ephemeralos start    Start the gateway and print the address to open

Options:
  --home <dir>         Use this folder instead of ~/.ephemeralos (or set EOS_HOME)
  --no-models          init: skip downloading the wake-word models
`;

const args = argv.slice(2);
const command = args.find((a) => !a.startsWith('-'));
const flag = (name: string) => args.includes(name);
const homeIndex = args.indexOf('--home');
const homeDir = resolveHome(homeIndex >= 0 ? args[homeIndex + 1] : undefined);

try {
  switch (command) {
    case 'init':
      await init({ homeDir, models: !flag('--no-models') });
      break;
    case 'start':
      await start({ homeDir });
      break;
    default:
      console.log(USAGE);
      exit(command && !flag('--help') ? 1 : 0);
  }
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  exit(1);
} finally {
  closePrompts();
}
