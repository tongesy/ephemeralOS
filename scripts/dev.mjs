#!/usr/bin/env node
// `pnpm dev`: run the gateway and the Vite dev server together.
// Both share one per-launch token so the page Vite serves can open the gateway WebSocket.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const VITE_PORT = 5173;
const env = {
  ...process.env,
  NODE_ENV: 'development',
  EOS_TOKEN: randomBytes(32).toString('base64url'),
  EOS_ALLOWED_ORIGINS: [`http://localhost:${VITE_PORT}`, `http://127.0.0.1:${VITE_PORT}`].join(','),
};

const tasks = [
  { name: 'gateway', color: 36, filter: '@ephemeralos/gateway' },
  { name: 'web', color: 35, filter: '@ephemeralos/web' },
];

const children = tasks.map(({ name, color, filter }) => {
  const child = spawn('pnpm', ['--filter', filter, 'dev'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const prefix = `\x1b[${color}m${name.padEnd(7)}\x1b[0m│ `;
  const pipe = (stream, out) =>
    stream.on('data', (chunk) => {
      for (const line of chunk.toString().split('\n')) if (line) out.write(prefix + line + '\n');
    });
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    if (code) console.error(`${prefix}exited with code ${code}`);
    shutdown(code ?? 0);
  });
  return child;
});

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
