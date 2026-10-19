import { z } from 'zod';
import { isArtworkUrl } from '@ephemeralos/shared';

/*
 * Podcasts from Apple's public directory (the iTunes Search API, no key): find the show,
 * then its recent episodes, each with a direct link to its audio file.
 */

const SEARCH = 'https://itunes.apple.com/search';
const LOOKUP = 'https://itunes.apple.com/lookup';
const TIMEOUT_MS = 8000;

const Show = z.looseObject({
  collectionId: z.number(),
  collectionName: z.string(),
  artistName: z.string().optional(),
  artworkUrl600: z.string().optional(),
});

const Episode = z.looseObject({
  wrapperType: z.literal('podcastEpisode'),
  trackName: z.string(),
  collectionName: z.string().optional(),
  episodeUrl: z.string(),
  releaseDate: z.string().optional(),
  trackTimeMillis: z.number().optional(),
  artworkUrl600: z.string().optional(),
});

const Results = z.object({ results: z.array(z.unknown()) });

export interface FoundEpisode {
  audioUrl: string;
  title: string;
  show: string;
  artwork?: string;
  durationSeconds?: number;
  published?: string;
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

/** The episode whose title shares the most words with what was asked for; the latest on a tie. */
export function pickEpisode<T extends { trackName: string }>(
  episodes: T[],
  wanted?: string,
): T | undefined {
  if (!wanted) return episodes[0];
  const want = words(wanted);
  let best = episodes[0];
  let bestScore = 0;
  for (const episode of episodes) {
    let score = 0;
    for (const w of words(episode.trackName)) if (want.has(w)) score++;
    if (score > bestScore) [best, bestScore] = [episode, score];
  }
  return best;
}

const httpsArt = (url?: string): string | undefined => (url && isArtworkUrl(url) ? url : undefined);

/**
 * Find a show by name and pick an episode: the latest, or the one whose title best matches
 * `episode`. Null when there is no such show or it has no playable episodes.
 */
export async function findEpisode(
  query: string,
  episode: string | undefined,
  options: { fetch?: typeof fetch; country?: string } = {},
): Promise<FoundEpisode | null> {
  const doFetch = options.fetch ?? fetch;
  const country = options.country ?? 'US';
  const get = async (url: string) => {
    const res = await doFetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Apple Podcasts answered ${res.status}`);
    return Results.parse(await res.json()).results;
  };

  const search = new URLSearchParams({
    term: query,
    media: 'podcast',
    entity: 'podcast',
    limit: '5',
    country,
  });
  const show = (await get(`${SEARCH}?${search}`))
    .map((r) => Show.safeParse(r))
    .find((r) => r.success)?.data;
  if (!show) return null;

  const lookup = new URLSearchParams({
    id: String(show.collectionId),
    media: 'podcast',
    entity: 'podcastEpisode',
    limit: '50',
    country,
  });
  const episodes = (await get(`${LOOKUP}?${lookup}`))
    .flatMap((r) => {
      const parsed = Episode.safeParse(r);
      return parsed.success && /^https:\/\//.test(parsed.data.episodeUrl) ? [parsed.data] : [];
    })
    .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));
  const chosen = pickEpisode(episodes, episode);
  if (!chosen) return null;
  const seconds = chosen.trackTimeMillis ? Math.round(chosen.trackTimeMillis / 1000) : 0;
  return {
    audioUrl: chosen.episodeUrl,
    title: chosen.trackName,
    show: show.collectionName,
    ...((httpsArt(chosen.artworkUrl600) ?? httpsArt(show.artworkUrl600)) && {
      artwork: httpsArt(chosen.artworkUrl600) ?? httpsArt(show.artworkUrl600),
    }),
    ...(seconds > 0 && seconds <= 86_400 && { durationSeconds: seconds }),
    ...(chosen.releaseDate && { published: chosen.releaseDate.slice(0, 10) }),
  };
}
