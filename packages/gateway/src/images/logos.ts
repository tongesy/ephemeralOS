import { join } from 'node:path';
import { logoDomain } from '@ephemeralos/shared';
import { loadHome } from '../home.ts';
import { createImageCache, type Image } from './image-cache.ts';

/*
 * Logos: `/logos/arsenal.com` is the club's logo. Without a key the gateway asks public
 * favicon services; with a logo.dev token (LOGO_DEV_TOKEN in .env) it asks logo.dev first.
 * The token stays here. Only a bare public domain is ever sent, and only to these services.
 */

/** Where to ask, best first. Each answers a miss with a 404. */
export function logoSources(domain: string, logoDevToken?: string): string[] {
  const name = encodeURIComponent(domain);
  return [
    ...(logoDevToken
      ? [
          `https://img.logo.dev/${name}?token=${encodeURIComponent(logoDevToken)}&size=128&format=png&fallback=404`,
        ]
      : []),
    `https://www.google.com/s2/favicons?domain=${name}&sz=128`,
    `https://icons.duckduckgo.com/ip3/${name}.ico`,
  ];
}

export interface LogoService {
  /** The logo for a domain; null when there is none or the name isn't a public domain. */
  get(domain: string): Promise<Image | null>;
}

export function createLogoService(options: { homeDir: string; fetch?: typeof fetch }): LogoService {
  const cache = createImageCache({
    dir: join(options.homeDir, 'cache', 'logos'),
    maxBytes: 256 * 1024,
    minBytes: 100,
    label: 'logos',
    fetch: options.fetch ?? fetch,
    sources: async (domain) => {
      const { secrets } = await loadHome(options.homeDir);
      return logoSources(domain, secrets.logoDevToken);
    },
  });
  return {
    get: (raw) => (logoDomain(raw) === raw ? cache.get(raw) : Promise.resolve(null)),
  };
}
