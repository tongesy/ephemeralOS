import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { TOKEN_META_NAME, YOUTUBE_EMBED_ORIGIN } from '@ephemeralos/shared';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.onnx': 'application/octet-stream',
  '.wasm': 'application/wasm',
};

// Fonts are self-hosted. The page talks to the gateway and, for the voice session, to
// OpenAI (SDP exchange; the audio itself is WebRTC). The wake word runs ONNX models in
// WebAssembly, which needs 'wasm-unsafe-eval' (it does not allow JavaScript eval).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "media-src 'self' blob: mediastream:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  // https images only for logos and photos in displays (loaded with no referrer).
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://api.openai.com",
  // Videos play in YouTube's privacy-enhanced player, and nothing else is framed.
  `frame-src ${YOUTUBE_EMBED_ORIGIN}`,
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

export function injectToken(html: string, token: string): string {
  const tag = `<meta name="${TOKEN_META_NAME}" content="${token}">`;
  return html.replace('</head>', `  ${tag}\n  </head>`);
}

/** Serve a file from the built web client. The token is injected into index.html only. */
export async function serveStatic(
  root: string,
  urlPath: string,
  token: string,
  res: ServerResponse,
): Promise<void> {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const file = normalize(join(root, rel));
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  let body: Buffer;
  try {
    body = await readFile(file);
  } catch {
    res.writeHead(404).end();
    return;
  }
  const ext = extname(file);
  const headers: Record<string, string> = {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
  if (ext === '.html') {
    headers['Content-Security-Policy'] = CSP;
    headers['Cache-Control'] = 'no-store';
    res.writeHead(200, headers).end(injectToken(body.toString('utf8'), token));
    return;
  }
  if (rel.startsWith('assets/')) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  res.writeHead(200, headers).end(body);
}
