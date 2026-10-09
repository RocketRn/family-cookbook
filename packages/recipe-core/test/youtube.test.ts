import { describe, expect, it } from 'vitest';
import { parseYoutube } from '../src/index.js';

const ID = 'dQw4w9WgXcQ';

describe('parseYoutube', () => {
  it.each<[string, { id: string; startSec: number | null } | null]>([
    [ID, { id: ID, startSec: null }],
    [`https://www.youtube.com/watch?v=${ID}`, { id: ID, startSec: null }],
    [`https://youtube.com/watch?v=${ID}&t=90`, { id: ID, startSec: 90 }],
    [`https://m.youtube.com/watch?v=${ID}&t=1m30s`, { id: ID, startSec: 90 }],
    [`https://youtu.be/${ID}?t=42`, { id: ID, startSec: 42 }],
    [`https://www.youtube.com/embed/${ID}?start=10`, { id: ID, startSec: 10 }],
    [`https://www.youtube.com/shorts/${ID}`, { id: ID, startSec: null }],
    [`https://www.youtube-nocookie.com/embed/${ID}`, { id: ID, startSec: null }],
    ['https://vimeo.com/123', null],
    ['https://www.youtube.com/watch?v=short', null],
    ['not a url', null],
    [`https://evil.example/watch?v=${ID}`, null],
  ])('%s', (input, expected) => {
    expect(parseYoutube(input)).toEqual(expected);
  });
});
