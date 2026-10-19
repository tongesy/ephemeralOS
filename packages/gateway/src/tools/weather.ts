import { z } from 'zod';
import { toolParameters, type DisplayArgs } from '@ephemeralos/shared';
import { loadHome } from '../home.ts';
import type { GatewayTool } from './registry.ts';

/**
 * Weather from Open-Meteo (open-meteo.com): free, no key, no account. Place names are
 * geocoded with its geocoding API. The forecast goes on screen as a table; the model gets
 * the same numbers to summarise aloud.
 */

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

export const WeatherArgs = z.object({
  location: z
    .string()
    .max(120)
    .optional()
    .describe("A place name; leave out for the user's home location"),
  days: z.number().int().min(1).max(14).optional().describe('How many days; default 7'),
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
  current: z.object({ temperature_2m: z.number(), weather_code: z.number() }).optional(),
  daily: z.object({
    time: z.array(z.string()),
    weather_code: z.array(z.number()),
    temperature_2m_max: z.array(z.number()),
    temperature_2m_min: z.array(z.number()),
    precipitation_probability_max: z.array(z.number().nullable()),
  }),
});

async function getJson<T extends z.ZodType>(doFetch: typeof fetch, url: URL, schema: T) {
  const res = await doFetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`The weather service answered ${res.status}`);
  return schema.parse(await res.json()) as z.infer<T>;
}

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

      const geoUrl = new URL(GEOCODE_URL);
      geoUrl.search = new URLSearchParams({ name: query, count: '1', language: 'en' }).toString();
      const place = (await getJson(doFetch, geoUrl, Geocode)).results?.[0];
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
        current: 'temperature_2m,weather_code',
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
        days: forecastDays,
        shownOnScreen: forecastDays.length > 1,
        source: 'Open-Meteo',
      };
    },
  };
}
