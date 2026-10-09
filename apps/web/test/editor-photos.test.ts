import { describe, expect, it, vi } from 'vitest';
import {
  fitWithin,
  PHOTO_ACCEPT,
  PhotoError,
  preparePhoto,
  uploadName,
  type PhotoDeps,
} from '../src/editor/photos';

/** A file of a given type and size (the content does not matter: decoding is faked). */
const file = (type: string, bytes: number, name = 'photo.jpg') =>
  new File([new Uint8Array(bytes)], name, { type });

function deps(width: number, height: number, fail = false) {
  const out = new Blob([new Uint8Array(500_000)], { type: 'image/jpeg' });
  const d: PhotoDeps = {
    decode: vi.fn(async () => {
      if (fail) throw new Error('cannot decode');
      return { width, height, source: {} as CanvasImageSource, close: vi.fn() };
    }),
    encode: vi.fn(async () => out),
  };
  return { d, out };
}

describe('photos before upload (FE-04, iPhone decision)', () => {
  it('the picker accepts only JPEG, PNG and WebP (so iOS hands over JPEG, not HEIC)', () => {
    expect(PHOTO_ACCEPT).toBe('image/jpeg,image/png,image/webp');
  });

  it('fits the long side into 2048 px and keeps the proportions', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2048, height: 1536, scaled: true });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1536, height: 2048, scaled: true });
    expect(fitWithin(2048, 100)).toEqual({ width: 2048, height: 100, scaled: false });
    expect(fitWithin(10_000, 1)).toEqual({ width: 2048, height: 1, scaled: true });
  });

  it('a big photo is redrawn at most 2048 px as JPEG, quality 0.8', async () => {
    const { d, out } = deps(4032, 3024);
    expect(await preparePhoto(file('image/jpeg', 4_000_000), d)).toBe(out);
    expect(d.encode).toHaveBeenCalledWith(expect.anything(), 2048, 1536, 0.8);
  });

  it('a small, light photo is sent as it is', async () => {
    const { d } = deps(1200, 900);
    const f = file('image/png', 800_000, 'a.png');
    expect(await preparePhoto(f, d)).toBe(f);
    expect(d.encode).not.toHaveBeenCalled();
  });

  it('a heavy photo within 2048 px is re-saved as JPEG to make it lighter', async () => {
    const { d, out } = deps(2000, 1500);
    expect(await preparePhoto(file('image/webp', 6_000_000, 'a.webp'), d)).toBe(out);
    expect(d.encode).toHaveBeenCalledWith(expect.anything(), 2000, 1500, 0.8);
  });

  it('HEIC and other types are refused before anything is uploaded', async () => {
    const { d } = deps(100, 100);
    await expect(preparePhoto(file('image/heic', 10, 'IMG_1.HEIC'), d)).rejects.toMatchObject({
      code: 'HEIC_NOT_SUPPORTED',
    });
    await expect(preparePhoto(file('', 10, 'IMG_2.heif'), d)).rejects.toBeInstanceOf(PhotoError);
    await expect(preparePhoto(file('image/gif', 10, 'a.gif'), d)).rejects.toMatchObject({
      code: 'UNSUPPORTED_IMAGE_TYPE',
    });
    expect(d.decode).not.toHaveBeenCalled();
  });

  it('a photo the browser cannot read goes to the server (which explains) if it is not too big', async () => {
    const small = file('image/jpeg', 1000);
    expect(await preparePhoto(small, deps(0, 0, true).d)).toBe(small);
    await expect(
      preparePhoto(file('image/jpeg', 11 * 1024 * 1024), deps(0, 0, true).d),
    ).rejects.toMatchObject({ code: 'IMAGE_INVALID' });
  });

  it('names the upload after the original, with .jpg when it was redrawn', () => {
    const f = file('image/png', 10, 'Пирог.png');
    expect(uploadName(f, f)).toBe('Пирог.png');
    expect(uploadName(f, new Blob())).toBe('Пирог.jpg');
  });
});
