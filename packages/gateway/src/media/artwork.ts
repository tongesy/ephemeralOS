import { join } from 'node:path';
import { isArtworkUrl } from '@ephemeralos/shared';
import { createImageCache, type Image } from '../images/image-cache.ts';

/** Podcast artwork from Apple's image hosts, cached and served as `/art/<artwork URL>`. */
export function createArtworkService(options: { homeDir: string; fetch?: typeof fetch }): {
  get(url: string): Promise<Image | null>;
} {
  const cache = createImageCache({
    dir: join(options.homeDir, 'cache', 'artwork'),
    maxBytes: 3 * 1024 * 1024,
    minBytes: 1000,
    label: 'artwork',
    fetch: options.fetch ?? fetch,
    sources: async (url) => [url],
  });
  return { get: (url) => (isArtworkUrl(url) ? cache.get(url) : Promise.resolve(null)) };
}
