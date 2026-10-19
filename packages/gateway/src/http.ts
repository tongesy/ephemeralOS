import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Constant-time token comparison. */
export function tokensMatch(given: string | null | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Hosts the gateway answers to. Checking `Host` defeats DNS rebinding: a page on
 * another domain re-pointed at 127.0.0.1 still sends its own host name.
 */
export function allowedHosts(port: number, origins: readonly string[]): Set<string> {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  for (const origin of origins) {
    try {
      hosts.add(new URL(origin).host);
    } catch {
      // Ignore malformed entries; they can't match anyway.
    }
  }
  return hosts;
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res
    .writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    .end(JSON.stringify(body));
}

/** Read a small request body; API calls carry little or nothing. */
export async function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
