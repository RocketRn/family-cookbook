import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import '../src/media/process.js';

/**
 * Small server (D-045): each photo is processed once, so the image library keeps no cache
 * (its default holds up to 50 MB), and it uses at most two threads per image.
 */
describe('image processing memory', () => {
  it('keeps no image cache and limits its threads', () => {
    expect(sharp.cache()).toMatchObject({
      memory: { max: 0 },
      items: { max: 0 },
      files: { max: 0 },
    });
    expect(sharp.concurrency()).toBeLessThanOrEqual(2);
  });
});
