import { describe, expect, it } from 'vitest';
import { ClientMessage, ORB_STATES, isOrbState, parseMessage } from '../src/index.ts';

describe('parseMessage', () => {
  it('accepts a valid hello', () => {
    const r = parseMessage(ClientMessage, JSON.stringify({ type: 'hello', protocol: 1 }));
    expect(r).toEqual({ ok: true, value: { type: 'hello', protocol: 1 } });
  });

  it('rejects invalid JSON without throwing', () => {
    expect(parseMessage(ClientMessage, '{nope')).toEqual({ ok: false, error: 'invalid JSON' });
  });

  it('rejects unknown message types', () => {
    const r = parseMessage(ClientMessage, JSON.stringify({ type: 'rm -rf' }));
    expect(r.ok).toBe(false);
  });
});

describe('orb states', () => {
  it('has the five lifecycle states in order', () => {
    expect(ORB_STATES).toEqual(['zen', 'listening', 'thinking', 'speaking', 'error']);
  });

  it('narrows strings', () => {
    expect(isOrbState('speaking')).toBe(true);
    expect(isOrbState('dancing')).toBe(false);
  });
});
