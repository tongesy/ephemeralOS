#!/usr/bin/env node
// Run the TypeScript CLI directly; ephemeralOS has no build step outside the web client.
import { register } from 'tsx/esm/api';

register();
await import('../src/main.ts');
