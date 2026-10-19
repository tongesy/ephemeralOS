import type { DisplayRequest } from '@ephemeralos/shared';
import { renderChart } from './chart.ts';
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
        li.append(text('span', 'surface__label', item.label));
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
        for (const cell of row) {
          tr.append(text('td', typeof cell === 'number' ? 'is-number' : '', String(cell)));
        }
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
