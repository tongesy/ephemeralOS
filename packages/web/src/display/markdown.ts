/**
 * The card body's Markdown subset: paragraphs, `- ` bullets, **bold**, *italic* and
 * `code`. Parsed to a tiny tree and built with DOM calls (never innerHTML), so model or
 * web text can't inject markup.
 */

export type Inline = { kind: 'text' | 'strong' | 'em' | 'code'; text: string };
export type Block = { kind: 'p'; inlines: Inline[] } | { kind: 'ul'; items: Inline[][] };

const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  for (const part of text.split(INLINE)) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      out.push({ kind: 'strong', text: part.slice(2, -2) });
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      out.push({ kind: 'code', text: part.slice(1, -1) });
    } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      out.push({ kind: 'em', text: part.slice(1, -1) });
    } else {
      out.push({ kind: 'text', text: part });
    }
  }
  return out;
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: Inline[][] | null = null;

  const flush = (): void => {
    if (paragraph.length) blocks.push({ kind: 'p', inlines: parseInline(paragraph.join(' ')) });
    paragraph = [];
    if (list) blocks.push({ kind: 'ul', items: list });
    list = null;
  };

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    if (!line) {
      flush();
    } else if (bullet) {
      if (paragraph.length) {
        blocks.push({ kind: 'p', inlines: parseInline(paragraph.join(' ')) });
        paragraph = [];
      }
      (list ??= []).push(parseInline(bullet[1]!));
    } else {
      if (list) flush();
      // Headings are shown as bold paragraphs: a card has one title already.
      const heading = /^#{1,6}\s+(.*)$/.exec(line);
      paragraph.push(heading ? `**${heading[1]}**` : line);
    }
  }
  flush();
  return blocks;
}

const TAGS: Record<Inline['kind'], string | null> = {
  text: null,
  strong: 'strong',
  em: 'em',
  code: 'code',
};

function inlineNodes(inlines: Inline[]): Node[] {
  return inlines.map((i) => {
    const tag = TAGS[i.kind];
    if (!tag) return document.createTextNode(i.text);
    const el = document.createElement(tag);
    el.textContent = i.text;
    return el;
  });
}

export function renderMarkdown(source: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const block of parseMarkdown(source)) {
    if (block.kind === 'p') {
      const p = document.createElement('p');
      p.append(...inlineNodes(block.inlines));
      fragment.append(p);
    } else {
      const ul = document.createElement('ul');
      for (const item of block.items) {
        const li = document.createElement('li');
        li.append(...inlineNodes(item));
        ul.append(li);
      }
      fragment.append(ul);
    }
  }
  return fragment;
}
