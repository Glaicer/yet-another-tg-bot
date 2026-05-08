import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('smoke', () => {
  it('should import createApp', () => {
    const app = createApp();
    expect(app).toBeDefined();
    expect(typeof app.start).toBe('function');
    expect(typeof app.stop).toBe('function');
  });
});
