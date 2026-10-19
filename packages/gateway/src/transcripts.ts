import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface TranscriptLine {
  at: string;
  sessionId: string;
  role: 'user' | 'assistant';
  text: string;
}

/** Append one turn to today's local JSONL transcript (`transcripts/YYYY-MM-DD.jsonl`). */
export async function appendTranscript(
  dir: string,
  line: Omit<TranscriptLine, 'at'>,
  now = new Date(),
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const day = now.toISOString().slice(0, 10);
  const entry: TranscriptLine = { at: now.toISOString(), ...line };
  await appendFile(join(dir, `${day}.jsonl`), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}
