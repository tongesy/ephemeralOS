import { LOGOS_PATH, type DisplayRequest, type IconName } from '@ephemeralos/shared';
import { renderChart } from './chart.ts';
import { ICON_PATHS } from './icon-paths.ts';
import { renderMarkdown } from './markdown.ts';

function text<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  content: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = content;
  return node;
}

/**
 * A small inline image (logo, crest, flag). One that fails to load gives way to the
 * bundled icon, if there is one, or simply disappears.
 */
function picture(url: string, fallback: SVGSVGElement | null): HTMLImageElement {
  const img = document.createElement('img');
  img.className = 'surface__icon';
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  img.decoding = 'async';
  img.src = url;
  img.addEventListener('error', () => (fallback ? img.replaceWith(fallback) : img.remove()), {
    once: true,
  });
  return img;
}

/** The mark beside a row or item: its image, else its site's logo, else a bundled icon. */
function mark(image?: string, domain?: string, iconName?: string): Element | null {
  const fallback = iconName ? glyph(iconName) : null;
  if (image) return picture(image, fallback);
  if (domain) return picture(`${LOGOS_PATH}${encodeURIComponent(domain)}`, fallback);
  return fallback;
}

const SVG = 'http://www.w3.org/2000/svg';

/** A bundled icon, drawn from path data (never markup) in the current text colour. */
function glyph(name: string): SVGSVGElement | null {
  const d = ICON_PATHS[name as IconName];
  if (!d) return null;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 256 256');
  svg.setAttribute('class', 'surface__icon surface__glyph');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}

/** Build the surface for one display request. Every string from the model is text, not HTML. */
export function renderSurface(request: DisplayRequest): HTMLElement {
  const { content } = request;
  const section = document.createElement('section');
  section.className = `surface surface--${content.component} glass`;
  section.setAttribute('aria-live', 'polite');
  if (request.title) section.append(text('h2', 'surface__title', request.title));

  switch (content.component) {
    case 'card': {
      if (content.imageUrl) {
        const img = document.createElement('img');
        img.className = 'surface__image';
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        img.decoding = 'async';
        img.src = content.imageUrl;
        // A broken image should vanish, not leave an icon behind.
        img.addEventListener('error', () => img.remove(), { once: true });
        section.append(img);
      }
      const body = document.createElement('div');
      body.className = 'surface__body';
      body.append(renderMarkdown(content.body));
      section.append(body);
      break;
    }
    case 'list': {
      const ol = document.createElement('ol');
      ol.className = 'surface__list';
      for (const item of content.items) {
        const li = document.createElement('li');
        const label = text('span', 'surface__label', item.label);
        const beside = mark(item.image_url, item.domain, item.icon);
        if (beside) label.prepend(beside);
        li.append(label);
        if (item.detail) li.append(text('span', 'surface__detail', item.detail));
        ol.append(li);
      }
      section.append(ol);
      break;
    }
    case 'table': {
      const table = document.createElement('table');
      table.className = 'surface__table';
      const head = table.createTHead().insertRow();
      head.append(text('th', 'surface__index', ''));
      for (const column of content.columns) head.append(text('th', '', column));
      const body = table.createTBody();
      content.rows.forEach((row, i) => {
        const tr = body.insertRow();
        tr.append(text('td', 'surface__index', String(i + 1)));
        row.forEach((cell, c) => {
          const td = text('td', typeof cell === 'number' ? 'is-number' : '', String(cell));
          if (c === (content.iconColumn ?? 0)) {
            const beside = mark(
              content.rowImages?.[i],
              content.rowDomains?.[i],
              content.rowIcons?.[i],
            );
            if (beside) td.prepend(beside);
          }
          tr.append(td);
        });
      });
      section.append(table);
      break;
    }
    case 'chart':
      section.append(renderChart(content.chart));
      break;
  }
  if (request.source) section.append(text('p', 'surface__source', request.source));
  return section;
}

/** The numbered items of a surface (list items or table rows), for "open number two". */
export function numberedItems(surface: HTMLElement): HTMLElement[] {
  return [
    ...surface.querySelectorAll<HTMLElement>('.surface__list > li, .surface__table tbody tr'),
  ];
}

/** What an item says, for the model to talk about after "open number N". */
export function describeItem(item: HTMLElement): string {
  if (item instanceof HTMLTableRowElement) {
    const headers = [...(item.closest('table')?.querySelectorAll('thead th') ?? [])]
      .slice(1)
      .map((th) => th.textContent ?? '');
    return [...item.cells]
      .slice(1)
      .map((cell, i) => `${headers[i] ?? ''}: ${cell.textContent ?? ''}`)
      .join(', ');
  }
  return [...item.children].map((c) => c.textContent ?? '').join(' — ');
}
