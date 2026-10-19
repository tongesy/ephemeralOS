import { PHOTOS_PATH, type GalleryImage } from '@ephemeralos/shared';
import { renderMarkdown } from './markdown.ts';

/*
 * Magazine layouts for when a picture tells it best. A hero is one photo, full bleed, with
 * the headline set over it; a gallery is a mosaic of up to eight; a slideshow shows one at
 * a time, full screen, drifting slowly (Ken Burns) and moving on by itself, or on "next".
 */

/** How long each slide holds before the next fades in. */
const SLIDE_MS = 6500;

export function pictureUrl(picture: { photo?: string; imageUrl?: string }): string | null {
  if (picture.photo) return `${PHOTOS_PATH}${encodeURIComponent(picture.photo)}`;
  return picture.imageUrl ?? null;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  content?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

/**
 * A photo that develops in once loaded. If it fails, `onMissing` decides what happens
 * (by default it simply goes).
 */
function photo(url: string, alt: string, onMissing?: (img: HTMLImageElement) => void) {
  const img = element('img', 'editorial__img');
  img.alt = alt;
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.src = url;
  img.addEventListener('load', () => img.setAttribute('data-loaded', ''), { once: true });
  img.addEventListener('error', () => (onMissing ? onMissing(img) : img.remove()), {
    once: true,
  });
  return img;
}

/** One photo, full bleed, the title over it. Without a photo it falls back to a card. */
export function renderHero(
  section: HTMLElement,
  title: string | undefined,
  content: { body?: string; kicker?: string; photo?: string; imageUrl?: string },
): void {
  const url = pictureUrl(content);
  if (url) {
    section.append(
      photo(url, title ?? '', (img) => {
        img.remove();
        section.classList.add('is-imageless', 'glass');
      }),
    );
  }
  const text = element('div', 'editorial__text');
  text.dataset.occupies = '';
  if (content.kicker) text.append(element('p', 'editorial__kicker', content.kicker));
  if (title) text.append(element('h2', 'editorial__title', title));
  if (content.body) {
    const dek = element('div', 'editorial__dek');
    dek.append(renderMarkdown(content.body));
    text.append(dek);
  }
  section.append(text);
}

export function renderGallery(
  section: HTMLElement,
  title: string | undefined,
  images: GalleryImage[],
  slideshow: boolean,
): void {
  const frames = images.flatMap((image) => {
    const url = pictureUrl({ photo: image.photo, imageUrl: image.image_url });
    if (!url) return [];
    const figure = element('figure', 'editorial__frame');
    figure.append(photo(url, image.caption ?? image.photo ?? '', () => figure.remove()));
    if (image.caption) figure.append(element('figcaption', 'editorial__caption', image.caption));
    return [figure];
  });
  const stage = element('div', slideshow ? 'editorial__slides' : 'editorial__mosaic');
  stage.dataset.count = String(frames.length);
  stage.append(...frames);
  if (!slideshow) stage.dataset.occupies = '';
  section.append(stage);
  if (title) {
    const heading = element('h2', 'editorial__title', title);
    heading.dataset.occupies = '';
    // A slideshow's title sits over the pictures, so it comes after them.
    if (slideshow) section.append(heading);
    else section.prepend(heading);
  }
  if (slideshow) startSlideshow(section, stage);
}

const shows = new WeakMap<HTMLElement, { stage: HTMLElement; index: number }>();

function startSlideshow(section: HTMLElement, stage: HTMLElement): void {
  const show = { stage, index: 0 };
  shows.set(section, show);
  stage.children[0]?.setAttribute('data-current', '');
  const timer = setInterval(() => {
    // The surface has gone (faded out or replaced): stop.
    if (!section.isConnected) return clearInterval(timer);
    advance(show, 1, true);
  }, SLIDE_MS);
}

function advance(show: { stage: HTMLElement; index: number }, by: number, loop: boolean) {
  const frames = [...show.stage.children];
  if (frames.length < 2) return false;
  const next = show.index + by;
  if (!loop && (next < 0 || next >= frames.length)) return false;
  show.index = (next + frames.length) % frames.length;
  frames.forEach((f, i) => f.toggleAttribute('data-current', i === show.index));
  return true;
}

/**
 * "Next" and "back" on a slideshow move between its pictures before they move between
 * surfaces. Returns whether it moved.
 */
export function stepSlides(section: HTMLElement, by: 1 | -1): boolean {
  const show = shows.get(section);
  return show ? advance(show, by, false) : false;
}
