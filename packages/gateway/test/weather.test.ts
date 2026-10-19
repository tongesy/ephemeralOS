import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parseDisplay } from '@ephemeralos/shared';
import { createWeatherTool, describeSky } from '../src/tools/weather.ts';

const GEO = {
  results: [
    {
      name: 'Copenhagen',
      latitude: 55.68,
      longitude: 12.57,
      country: 'Denmark',
      admin1: 'Capital Region',
    },
  ],
};
const FORECAST = {
  current: { temperature_2m: 11.4, weather_code: 2 },
  daily: {
    time: ['2026-10-19', '2026-10-20', '2026-10-21'],
    weather_code: [2, 61, 0],
    temperature_2m_max: [13.6, 11.2, 14.9],
    temperature_2m_min: [7.4, 6.6, 5.1],
    precipitation_probability_max: [10, 80, null],
  },
};

function fakeFetch() {
  return vi.fn(async (url: URL | string) => {
    const href = String(url);
    const body = href.includes('geocoding') ? GEO : FORECAST;
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

async function home(config: object): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'eos-weather-'));
  await writeFile(join(dir, 'config.json'), JSON.stringify(config));
  return dir;
}

describe('weather tool', () => {
  it('uses the home location, shows a forecast table and returns the numbers', async () => {
    const fetchMock = fakeFetch();
    const tool = createWeatherTool({
      homeDir: await home({ location: 'Copenhagen' }),
      fetch: fetchMock as unknown as typeof fetch,
    });
    const shown: unknown[] = [];
    const result = (await tool.run({ days: 3 }, { display: (a) => shown.push(a) })) as Record<
      string,
      unknown
    >;

    expect(String(fetchMock.mock.calls[0]![0])).toContain('name=Copenhagen');
    const forecastUrl = String(fetchMock.mock.calls[1]![0]);
    expect(forecastUrl).toContain('forecast_days=3');
    expect(forecastUrl).toContain('temperature_unit=celsius');

    expect(result).toMatchObject({
      place: 'Copenhagen, Capital Region, Denmark',
      unit: '°C',
      now: { temperature: 11, sky: 'Partly cloudy' },
      days: [
        { day: 'Today', sky: 'Partly cloudy', high: 14, low: 7, rainChance: 10 },
        { day: 'Tue 20', sky: 'Light rain', high: 11, low: 7, rainChance: 80 },
        { day: 'Wed 21', sky: 'Clear', high: 15, low: 5, rainChance: null },
      ],
    });

    expect(shown).toHaveLength(1);
    const display = parseDisplay(shown[0]);
    expect(display.ok).toBe(true);
    expect(shown[0]).toMatchObject({
      id: 'weather',
      source: 'Weather data by Open-Meteo.com',
      component: 'table',
      rows: [
        ['Today', 'Partly cloudy', '14°', '7°', '10%'],
        expect.anything(),
        ['Wed 21', 'Clear', '15°', '5°', '–'],
      ],
      row_icons: ['cloud-sun', 'cloud-rain', 'sun'],
      icon_column: 1,
    });
    expect((result.days as object[])[0]).not.toHaveProperty('icon');
  });

  it('asks for a place when none is known, and says when a place is not found', async () => {
    const empty = vi.fn(async () => new Response('{}'));
    const tool = createWeatherTool({
      homeDir: await home({}),
      fetch: empty as unknown as typeof fetch,
    });
    const ctx = { display: () => {} };
    expect(await tool.run({}, ctx)).toMatchObject({
      error: expect.stringContaining('Ask the user'),
    });
    expect(await tool.run({ location: 'Atlantis' }, ctx)).toMatchObject({
      error: expect.stringContaining('Atlantis'),
    });
  });

  it('finds "Town, Country" by name and picks the right country', async () => {
    const fetchMock = vi.fn(async (url: URL | string) => {
      const href = String(url);
      if (!href.includes('geocoding')) return new Response(JSON.stringify(FORECAST));
      return new Response(
        JSON.stringify({
          results: [
            { name: 'Perth', latitude: -31.9, longitude: 115.9, country: 'Australia' },
            {
              name: 'Perth',
              latitude: 56.4,
              longitude: -3.4,
              country: 'United Kingdom',
              admin1: 'Scotland',
            },
          ],
        }),
      );
    });
    const tool = createWeatherTool({
      homeDir: await home({}),
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await tool.run({ location: 'Perth, UK', days: '3' }, { display: () => {} });
    expect(String(fetchMock.mock.calls[0]![0])).toContain('name=Perth&');
    expect(result).toMatchObject({ place: 'Perth, Scotland, United Kingdom' });
  });

  it('uses Fahrenheit for imperial users', async () => {
    const fetchMock = fakeFetch();
    const tool = createWeatherTool({
      homeDir: await home({ units: 'imperial' }),
      fetch: fetchMock as unknown as typeof fetch,
    });
    await tool.run({ location: 'Austin' }, { display: () => {} });
    expect(String(fetchMock.mock.calls[1]![0])).toContain('temperature_unit=fahrenheit');
  });

  it('names weather codes in plain words', () => {
    expect(describeSky(95)).toBe('Thunderstorms');
    expect(describeSky(1234)).toBe('Mixed');
  });
});
