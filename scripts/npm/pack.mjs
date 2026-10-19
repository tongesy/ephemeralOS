#!/usr/bin/env node
// `pnpm pack:npm`: assemble the `ephemeralos` npm package in dist-npm/, ready for
// `npm publish dist-npm`. The CLI and gateway are bundled into one file with no runtime
// dependencies; the built web client and the home templates are copied beside it.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../..', import.meta.url));
const out = join(root, 'dist-npm');
const cliSrc = join(root, 'packages/cli/src');
const webDist = join(root, 'packages/web/dist');

const rootPkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
await readFile(join(webDist, 'index.html')).catch(() => {
  throw new Error('Build the web client first: pnpm build');
});

await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'bin'), { recursive: true });

/** Point the CLI's paths module at the package layout instead of the monorepo's. */
const packagePaths = {
  name: 'package-paths',
  setup(b) {
    b.onResolve({ filter: /^\.\/paths\.ts$/ }, (args) =>
      dirname(args.importer) === cliSrc
        ? { path: fileURLToPath(new URL('./paths.ts', import.meta.url)) }
        : undefined,
    );
  },
};

await build({
  entryPoints: [join(cliSrc, 'main.ts')],
  outfile: join(out, 'bin/ephemeralos.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22.12',
  // ws loads these native speedups when present; it works without them.
  external: ['bufferutil', 'utf-8-validate'],
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
  plugins: [packagePaths],
  logLevel: 'warning',
});

await cp(webDist, join(out, 'web'), { recursive: true });
await cp(join(root, 'home'), join(out, 'home'), { recursive: true });
await cp(join(root, 'LICENSE'), join(out, 'LICENSE'));
await cp(join(root, 'README.md'), join(out, 'README.md'));

const pkg = {
  name: 'ephemeralos',
  version: (process.env.EOS_VERSION ?? rootPkg.version).replace(/^v/, ''),
  description: rootPkg.description,
  license: rootPkg.license,
  type: 'module',
  bin: { ephemeralos: 'bin/ephemeralos.mjs' },
  files: ['bin', 'web', 'home'],
  engines: rootPkg.engines,
  repository: { type: 'git', url: 'git+https://github.com/tongesy/ephemeralos.git' },
  homepage: 'https://github.com/tongesy/ephemeralos#readme',
  keywords: ['voice', 'assistant', 'agent', 'realtime', 'openai', 'claude'],
};
await writeFile(join(out, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`Packed ${pkg.name}@${pkg.version} in dist-npm/. Publish with: npm publish dist-npm`);
