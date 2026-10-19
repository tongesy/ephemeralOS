import { describe, expect, it } from 'vitest';
import { MediaItem, ServerMessage, youtubeId } from '../src/index.ts';

describe('youtubeId', () => {
  it('reads the id from every common kind of YouTube link', () => {
    for (const link of [
      'dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=30',
      'https://youtu.be/dQw4w9WgXcQ?si=abc',
      'https://m.youtube.com/shorts/dQw4w9WgXcQ',
      'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      'youtube.com/live/dQw4w9WgXcQ',
    ]) {
      expect(youtubeId(link), link).toBe('dQw4w9WgXcQ');
    }
  });

  it('refuses other sites and malformed ids', () => {
    for (const bad of [
      'https://evil.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=short',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQtoolong',
      'https://www.youtube.com/channel/UC123',
      '',
    ]) {
      expect(youtubeId(bad), bad).toBeNull();
    }
  });
});

describe('MediaItem', () => {
  it('accepts relay ids and YouTube ids only', () => {
    const audio = { kind: 'audio', id: 'a'.repeat(32), title: 'Episode 1', by: 'The Show' };
    expect(MediaItem.safeParse(audio).success).toBe(true);
    expect(MediaItem.safeParse({ ...audio, id: '../../etc/passwd' }).success).toBe(false);
    expect(MediaItem.safeParse({ ...audio, artwork: 'javascript:alert(1)' }).success).toBe(false);
    expect(MediaItem.safeParse({ ...audio, artwork: 'https://evil.com/a.jpg' }).success).toBe(
      false,
    );
    const art = 'https://is4-ssl.mzstatic.com/image/thumb/Podcasts/ab/600x600bb.jpg';
    expect(MediaItem.safeParse({ ...audio, artwork: art }).success).toBe(true);
    const video = { kind: 'video', youtube: 'dQw4w9WgXcQ', title: 'A video' };
    expect(MediaItem.safeParse(video).success).toBe(true);
    expect(MediaItem.safeParse({ ...video, youtube: 'https://x.y/z' }).success).toBe(false);
  });

  it('travels from the gateway as a media message', () => {
    const msg = { type: 'media', item: { kind: 'video', youtube: 'dQw4w9WgXcQ', title: 'A' } };
    expect(ServerMessage.safeParse(msg).success).toBe(true);
  });
});
