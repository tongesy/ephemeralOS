import { defineConfig, type Plugin } from 'vite';
import { MODELS_PATH, TOKEN_META_NAME, WS_PATH } from '@ephemeralos/shared';

const GATEWAY = `http://127.0.0.1:${process.env.EOS_PORT ?? 4317}`;

/**
 * In dev, Vite serves the page, so it injects the per-launch token that `pnpm dev`
 * shares with the gateway. In production the gateway serves the page and injects it.
 */
function devToken(): Plugin {
  return {
    name: 'eos-dev-token',
    apply: 'serve',
    transformIndexHtml(html) {
      const token = process.env.EOS_TOKEN;
      if (!token) return html;
      return html.replace(
        '</head>',
        `  <meta name="${TOKEN_META_NAME}" content="${token}">\n  </head>`,
      );
    },
  };
}

export default defineConfig({
  plugins: [devToken()],
  server: {
    port: 5173,
    strictPort: true,
    // Everything but the page itself comes from the gateway, as it does in production.
    proxy: {
      [WS_PATH]: { target: GATEWAY, ws: true },
      '/api/': GATEWAY,
      [MODELS_PATH]: GATEWAY,
    },
  },
  worker: { format: 'es' },
  // onnxruntime-web locates its WebAssembly itself; pre-bundling would break that.
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  build: {
    target: 'es2023',
    assetsInlineLimit: 0,
    // three.js is one large chunk served from localhost; splitting it buys nothing here.
    chunkSizeWarningLimit: 800,
  },
});
