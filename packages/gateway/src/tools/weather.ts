import { z } from 'zod';
import {
  toolParameters,
  type DisplayArgs,
  type IconName,
  type Scene,
  type Sky,
} from '@ephemeralos/shared';
import { loadHome } from '../home.ts';
import type { GatewayTool } from './registry.ts';

/**
 * Weather from Open-Meteo (open-meteo.com): free, no key, no account. Place names are
 * geocoded with its geocoding API. The forecast goes on screen as a table; the model gets
 * the same numbers to summarise aloud.
 */

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 8000;

export const WeatherArgs = z.object({
  location: z
    .string()
    .max(120)
    .nullish()
    .describe("A place name; leave out for the user's home location"),
  days: z.coerce.number().int().min(1).max(14).nullish().describe('How many days; default 7'),
});

/** WMO weather interpretation codes, in plain words. */
const SKY: Record<number, string> = {
  0: 'Clear',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Freezing fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Showers',
  81: 'Showers',
  82: 'Heavy showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorms',
  96: 'Thunderstorms, hail',
  99: 'Thunderstorms, hail',
};

/** WMO code → the scene's sky and how heavy it is. */
const SKY_SCENES: [codes: number[], sky: Sky, intensity: number][] = [
  [[0], 'clear', 0],
  [[1], 'partly-cloudy', 0.25],
  [[2], 'partly-cloudy', 0.55],
  [[3], 'cloudy', 0.8],
  [[45, 48], 'fog', 0.7],
  [[51, 53, 55, 56, 57], 'rain', 0.2],
  [[61, 66, 80], 'rain', 0.45],
  [[63, 81], 'rain', 0.7],
  [[65, 67, 82], 'rain', 0.95],
  [[71, 77, 85], 'snow', 0.35],
  [[73], 'snow', 0.6],
  [[75, 86], 'snow', 0.9],
  [[95], 'thunder', 0.7],
  [[96, 99], 'thunder', 0.95],
];

/** The weather right now as a scene for the page; windKmh of 60 or more is a gale. */
export function weatherScene(code: number, isDay: boolean, windKmh = 0): Scene {
  const [, sky, intensity] = SKY_SCENES.find(([codes]) => codes.includes(code)) ?? [
    [],
    'cloudy',
    0.5,
  ];
  const wind = Math.round(Math.min(Math.max(windKmh / 60, 0), 1) * 100) / 100;
  return { kind: 'weather', sky, intensity, day: isDay, wind };
}

/** The bundled icon for a WMO weather code. */
export function skyIcon(code: number): IconName {
  if (code === 0) return 'sun';
  if (code <= 2) return 'cloud-sun';
  if (code === 3) return 'cloud';
  if (code <= 48) return 'cloud-fog';
  if (code <= 67 || (code >= 80 && code <= 82)) return 'cloud-rain';
  if (code <= 86) return 'cloud-snow';
  return 'cloud-lightning';
}

export function describeSky(code: number): string {
  return SKY[code] ?? 'Mixed';
}

const Geocode = z.object({
  results: z
    .array(
      z.object({
        name: z.string(),
        latitude: z.number(),
        longitude: z.number(),
        country: z.string().optional(),
        admin1: z.string().optional(),
      }),
    )
    .optional(),
});

const Forecast = z.object({
  current: z
    .object({
      temperature_2m: z.number(),
      weather_code: z.number(),
      is_day: z.number().optional(),
      wind_speed_10m: z.number().optional(),
    })
    .optional(),
  daily: z.object({
    time: z.array(z.string()),
    weather_code: z.array(z.number()),
    temperature_2m_max: z.array(z.number()),
    temperature_2m_min: z.array(z.number()),
    precipitation_probability_max: z.array(z.number().nullable()),
  }),
});

async function getJson<T extends z.ZodType>(doFetch: typeof fetch, url: URL, schema: T) {
  const res = await doFetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`The weather service answered ${res.status}`);
  return schema.parse(await res.json()) as z.infer<T>;
}

type Place = NonNullable<z.infer<typeof Geocode>['results']>[number];

/**
 * Open-Meteo matches a bare place name only, so "Brighton, UK" finds nothing. Search for
 * the part before the first comma and use the rest to pick between same-named places.
 */
async function geocode(doFetch: typeof fetch, query: string): Promise<Place | undefined> {
  const [name = '', ...rest] = query.split(',').map((part) => part.trim());
  const qualifiers = rest.filter(Boolean).map((part) => part.toLowerCase());
  const url = new URL(GEOCODE_URL);
  url.search = new URLSearchParams({ name, count: '10', language: 'en' }).toString();
  const results = (await getJson(doFetch, url, Geocode)).results ?? [];
  const matches = (place: Place, qualifier: string) =>
    [place.country, place.admin1].some((field) => {
      const value = field?.toLowerCase() ?? '';
      return value.includes(qualifier) || (ALIASES[qualifier] ?? []).includes(value);
    });
  return (
    results.find((place) => qualifiers.every((q) => matches(place, q))) ??
    results.find((place) => qualifiers.some((q) => matches(place, q))) ??
    results[0]
  );
}

/** Country short forms people say that don't appear in the full name. */
const ALIASES: Record<string, string[]> = {
  uk: ['united kingdom'],
  gb: ['united kingdom'],
  us: ['united states'],
  usa: ['united states'],
  uae: ['united arab emirates'],
};

/** "Mon 20" in the place's own calendar (dates arrive as local YYYY-MM-DD). */
function dayLabel(isoDate: string, index: number): string {
  if (index === 0) return 'Today';
  const date = new Date(`${isoDate}T12:00:00Z`);
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
  return `${weekday} ${date.getUTCDate()}`;
}

export function createWeatherTool(options: { homeDir: string; fetch?: typeof fetch }): GatewayTool {
  const doFetch = options.fetch ?? fetch;
  return {
    definition: {
      type: 'function',
      name: 'weather',
      description:
        'Current weather and the daily forecast for a place. Shows the forecast on screen; reply with a short spoken summary.',
      parameters: toolParameters(WeatherArgs),
    },
    async run(rawArgs, context) {
      const args = WeatherArgs.parse(rawArgs);
      const { config } = await loadHome(options.homeDir);
      const query = args.location || config.location;
      if (!query) {
        return { error: 'No location given and no home location set. Ask the user where.' };
      }

      const place = await geocode(doFetch, query);
      if (!place) return { error: `Couldn't find a place called "${query}".` };
      const placeName = [
        place.name,
        place.admin1 && place.admin1 !== place.name ? place.admin1 : null,
        place.country,
      ]
        .filter(Boolean)
        .join(', ');

      const imperial = config.units === 'imperial';
      const days = args.days ?? 7;
      const url = new URL(FORECAST_URL);
      url.search = new URLSearchParams({
        latitude: String(place.latitude),
        longitude: String(place.longitude),
        current: 'temperature_2m,weather_code,is_day,wind_speed_10m',
        wind_speed_unit: 'kmh',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
        timezone: 'auto',
        forecast_days: String(days),
        temperature_unit: imperial ? 'fahrenheit' : 'celsius',
      }).toString();
      const forecast = await getJson(doFetch, url, Forecast);

      const d = forecast.daily;
      const unit = imperial ? '°F' : '°C';
      const forecastDays = d.time.map((date, i) => ({
        day: dayLabel(date, i),
        sky: describeSky(d.weather_code[i] ?? -1),
        icon: skyIcon(d.weather_code[i] ?? -1),
        high: Math.round(d.temperature_2m_max[i] ?? NaN),
        low: Math.round(d.temperature_2m_min[i] ?? NaN),
        rainChance: d.precipitation_probability_max[i] ?? null,
      }));

      if (forecastDays.length > 1) {
        const table: DisplayArgs = {
          id: 'weather',
          component: 'table',
          title: `${place.name} · next ${forecastDays.length} days`,
          source: 'Weather data by Open-Meteo.com',
          columns: ['Day', 'Sky', 'High', 'Low', 'Rain'],
          rows: forecastDays.map((f) => [
            f.day,
            f.sky,
            `${f.high}°`,
            `${f.low}°`,
            f.rainChance === null ? '–' : `${f.rainChance}%`,
          ]),
          row_icons: forecastDays.map((f) => f.icon),
          icon_column: 1,
          ...(forecast.current && {
            scene: weatherScene(
              forecast.current.weather_code,
              forecast.current.is_day !== 0,
              forecast.current.wind_speed_10m,
            ),
          }),
        };
        context.display(table);
      }

      return {
        place: placeName,
        unit,
        now: forecast.current
          ? {
              temperature: Math.round(forecast.current.temperature_2m),
              sky: describeSky(forecast.current.weather_code),
            }
          : undefined,
        days: forecastDays.map(({ icon: _icon, ...day }) => day),
        shownOnScreen: forecastDays.length > 1,
        source: 'Open-Meteo',
      };
    },
  };
}
