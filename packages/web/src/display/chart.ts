import type { Chart } from '@ephemeralos/shared';
import { palette, seriesColors } from '../theme/palette.ts';

const SVG = 'http://www.w3.org/2000/svg';
const WIDTH = 560;
const HEIGHT = 260;
const PAD = { top: 16, right: 12, bottom: 32, left: 44 };

/** Round axis bounds and a step of 1, 2 or 5 × 10ⁿ, so gridlines land on tidy values. */
export function niceScale(
  min: number,
  max: number,
  ticks = 4,
): { min: number; max: number; step: number } {
  if (min === max) {
    const pad = Math.abs(min) || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
  return { min: Math.floor(min / step) * step, max: Math.ceil(max / step) * step, step };
}

/** Short number labels: 1200 → 1.2k, keeps decimals only when the step needs them. */
export function formatTick(value: number, step: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${+(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${+(value / 1e3).toFixed(1)}k`;
  const decimals = step < 1 ? Math.min(2, Math.ceil(-Math.log10(step))) : 0;
  return value.toFixed(decimals);
}

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  text?: string,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A calm bar or line chart in the shared palette. Labels are text nodes, never markup. */
export function renderChart(chart: Chart): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'surface__chart';

  const values = chart.series.flatMap((s) => s.values);
  const lo = chart.kind === 'bar' ? Math.min(0, ...values) : Math.min(...values);
  const scale = niceScale(lo, Math.max(...values));
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + plotH * (1 - (v - scale.min) / (scale.max - scale.min));
  const n = chart.labels.length;
  const band = plotW / n;
  const cx = (i: number) => PAD.left + band * (i + 0.5);

  const svg = el('svg', { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: 'img' });
  svg.append(el('title', {}, chart.series.map((s) => s.name).join(', ')));

  for (let v = scale.min; v <= scale.max + scale.step / 2; v += scale.step) {
    svg.append(
      el('line', { x1: PAD.left, x2: WIDTH - PAD.right, y1: y(v), y2: y(v), class: 'chart__grid' }),
      el(
        'text',
        {
          x: PAD.left - 8,
          y: y(v),
          class: 'chart__tick',
          'text-anchor': 'end',
          'dominant-baseline': 'middle',
        },
        formatTick(v, scale.step),
      ),
    );
  }

  // Thin out x labels so they never collide.
  const every = Math.ceil(n / Math.floor(plotW / 48));
  chart.labels.forEach((label, i) => {
    if (i % every !== 0) return;
    svg.append(
      el(
        'text',
        { x: cx(i), y: HEIGHT - 10, class: 'chart__tick', 'text-anchor': 'middle' },
        label,
      ),
    );
  });

  chart.series.forEach((series, s) => {
    const color = seriesColors[s % seriesColors.length]!;
    if (chart.kind === 'bar') {
      const groupW = band * 0.64;
      const barW = groupW / chart.series.length;
      series.values.forEach((v, i) => {
        const x = cx(i) - groupW / 2 + barW * s;
        const top = Math.min(y(v), y(0));
        svg.append(
          el('rect', {
            x: x + 1,
            y: top,
            width: Math.max(barW - 2, 1),
            height: Math.abs(y(v) - y(0)),
            rx: 3,
            fill: color,
          }),
        );
      });
    } else {
      const points = series.values.map((v, i) => `${cx(i)},${y(v)}`).join(' ');
      svg.append(
        el('polyline', {
          points,
          fill: 'none',
          stroke: color,
          'stroke-width': 2,
          'stroke-linejoin': 'round',
          'stroke-linecap': 'round',
        }),
      );
      series.values.forEach((v, i) =>
        svg.append(
          el('circle', {
            cx: cx(i),
            cy: y(v),
            r: 3,
            fill: palette.paper,
            stroke: color,
            'stroke-width': 2,
          }),
        ),
      );
    }
  });
  figure.append(svg);

  if (chart.series.length > 1 || chart.unit) {
    const legend = document.createElement('figcaption');
    legend.className = 'chart__legend';
    chart.series.forEach((series, s) => {
      const key = document.createElement('span');
      key.style.setProperty('--swatch', seriesColors[s % seriesColors.length]!);
      key.textContent = series.name;
      legend.append(key);
    });
    if (chart.unit) {
      const unit = document.createElement('span');
      unit.className = 'chart__unit';
      unit.textContent = chart.unit;
      legend.append(unit);
    }
    figure.append(legend);
  }
  return figure;
}
