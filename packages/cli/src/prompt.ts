import { stdin, stdout } from 'node:process';
import { createInterface, type Interface } from 'node:readline/promises';
import { Writable } from 'node:stream';

/** Echo goes through here so secret answers can be hidden. */
let muted = false;
const output = new Writable({
  write(chunk, _encoding, done) {
    if (!muted) stdout.write(chunk);
    done();
  },
});

// One interface for the whole run. Reading through its async iterator buffers lines,
// so answers piped in ahead of their questions are not lost.
let rl: Interface | undefined;
let iterator: AsyncIterator<string> | undefined;

async function nextLine(): Promise<string> {
  if (!rl) {
    rl = createInterface({ input: stdin, output, terminal: stdin.isTTY });
    iterator = rl[Symbol.asyncIterator]();
  }
  const next = await iterator!.next();
  if (next.done) throw new Error('Setup cancelled: no more input.');
  return next.value.trim();
}

export function closePrompts(): void {
  rl?.close();
  rl = undefined;
  iterator = undefined;
}

/** Ask a question with visible input. */
export async function ask(question: string): Promise<string> {
  stdout.write(question);
  return nextLine();
}

export async function confirm(question: string, fallback = true): Promise<boolean> {
  const answer = (await ask(`${question} ${fallback ? '[Y/n]' : '[y/N]'} `)).toLowerCase();
  return answer ? answer.startsWith('y') : fallback;
}

/** Ask for a secret without echoing it, so it never reaches the terminal or its scrollback. */
export async function askSecret(question: string): Promise<string> {
  stdout.write(`${question}\x1b[2m(hidden)\x1b[0m `);
  muted = true;
  try {
    return await nextLine();
  } finally {
    muted = false;
    stdout.write('\n');
  }
}
