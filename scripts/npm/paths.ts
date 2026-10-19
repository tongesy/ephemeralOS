// Stands in for packages/cli/src/paths.ts in the npm package, where the home templates and
// the built web client sit next to the bundled CLI rather than in the monorepo.
import { fileURLToPath } from 'node:url';

export { resolveHome } from '../../packages/cli/src/paths.ts';

export const TEMPLATES_DIR = fileURLToPath(new URL('../home', import.meta.url));
export const WEB_DIST_DIR = fileURLToPath(new URL('../web', import.meta.url));
