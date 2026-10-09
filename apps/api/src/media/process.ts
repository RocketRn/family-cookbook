import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { AppError } from '../errors.js';

/** PRD 7.1: photo <= 10 MB. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Decompression-bomb guard: refuse images with more pixels than this before decoding them. */
const MAX_INPUT_PIXELS = 50_000_000;
const FULL_SIDE = 2048;
const THUMB_SIDE = 512;

export type ImageKind = 'jpeg' | 'png' | 'webp' | 'avif' | 'heic' | 'gif' | 'unknown';

/** Detects the format from the file's bytes, never from its name or the client's content type. */
export function sniffImage(buf: Buffer): ImageKind {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'png';
  if (
    buf.length >= 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  )
    return 'webp';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString('latin1', 0, 6))) return 'gif';
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') {
    const brand = buf.toString('latin1', 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'avif';
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand))
      return 'heic';
  }
  return 'unknown';
}

export type ProcessedImage = {
  full: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  sha256: string;
};

const encode = (input: Buffer, side: number, quality: number) =>
  sharp(input, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS })
    .rotate() // apply the EXIF orientation before the metadata is dropped
    .resize({ width: side, height: side, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true }) // no withMetadata(): EXIF, GPS and other metadata are removed
    .toBuffer({ resolveWithObject: true });

/**
 * PRD 6.2 BE-05: type check by content, EXIF removal, resize. Output is always JPEG (what Telegram
 * sendPhoto and every WebView accept). HEIC needs a decoder our sharp build may not have: then the
 * user gets a clear, translated error instead of a 500 (D-028).
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  const kind = sniffImage(input);
  if (kind === 'gif' || kind === 'unknown') {
    throw new AppError(
      415,
      'UNSUPPORTED_IMAGE_TYPE',
      'Only JPEG, PNG, WebP or AVIF photos can be uploaded',
    );
  }
  try {
    const full = await encode(input, FULL_SIDE, 82);
    const thumb = await encode(input, THUMB_SIDE, 75);
    return {
      full: full.data,
      thumb: thumb.data,
      width: full.info.width,
      height: full.info.height,
      sha256: createHash('sha256').update(full.data).digest('hex'),
    };
  } catch (err) {
    if (kind === 'heic') {
      throw new AppError(
        415,
        'HEIC_NOT_SUPPORTED',
        'HEIC photos are not supported yet; please send JPEG',
      );
    }
    throw new AppError(422, 'IMAGE_INVALID', 'The image could not be read', {
      reason: err instanceof Error ? err.message.slice(0, 200) : 'unknown',
    });
  }
}
