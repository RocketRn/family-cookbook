/**
 * Photos before upload (PRD 6.2 FE-04, owner decision for iPhone photos, D-035).
 *
 * The file picker accepts only JPEG, PNG and WebP. On an iPhone this asks iOS to hand over a JPEG
 * instead of a HEIC original (the behaviour still needs a check on a real device). A photo whose
 * long side is over 2048 px, or that is large, is redrawn on a canvas at most 2048 px wide or high
 * and saved as JPEG at quality 0.8. The server still checks everything (BE-05, 10 MB limit).
 */
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const PHOTO_ACCEPT = PHOTO_TYPES.join(',');
export const PHOTO_MAX_SIDE = 2048;
export const PHOTO_QUALITY = 0.8;
/** Smaller files of an acceptable size are sent as they are. */
export const PHOTO_KEEP_BYTES = 3 * 1024 * 1024;
export const PHOTO_SERVER_LIMIT = 10 * 1024 * 1024;

/** Why a photo cannot be used; the codes match the API's (errors.* messages). */
export class PhotoError extends Error {
  constructor(
    readonly code:
      'HEIC_NOT_SUPPORTED' | 'UNSUPPORTED_IMAGE_TYPE' | 'IMAGE_TOO_LARGE' | 'IMAGE_INVALID',
  ) {
    super(code);
  }
}

/** The size to draw at: the long side at most `max`, proportions kept, whole pixels. */
export function fitWithin(
  width: number,
  height: number,
  max = PHOTO_MAX_SIDE,
): { width: number; height: number; scaled: boolean } {
  const long = Math.max(width, height);
  if (long <= max) return { width, height, scaled: false };
  const k = max / long;
  return {
    width: Math.max(1, Math.round(width * k)),
    height: Math.max(1, Math.round(height * k)),
    scaled: true,
  };
}

const isHeic = (f: File) => /^image\/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name);

export type Decoded = { width: number; height: number; source: CanvasImageSource; close(): void };
export type PhotoDeps = {
  decode(file: Blob): Promise<Decoded>;
  encode(source: CanvasImageSource, width: number, height: number, quality: number): Promise<Blob>;
};

/** Browser implementation: createImageBitmap (applies the photo's orientation) and a canvas. */
export const browserPhotoDeps: PhotoDeps = {
  async decode(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { width: bmp.width, height: bmp.height, source: bmp, close: () => bmp.close() };
  },
  encode(source, width, height, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return Promise.reject(new PhotoError('IMAGE_INVALID'));
    // JPEG has no transparency: a transparent PNG gets a white background, not a black one.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new PhotoError('IMAGE_INVALID'))),
        'image/jpeg',
        quality,
      ),
    );
  },
};

/** The photo to upload: the file itself, or a smaller JPEG drawn from it. */
export async function preparePhoto(file: File, deps: PhotoDeps = browserPhotoDeps): Promise<Blob> {
  if (isHeic(file)) throw new PhotoError('HEIC_NOT_SUPPORTED');
  if (!(PHOTO_TYPES as readonly string[]).includes(file.type))
    throw new PhotoError('UNSUPPORTED_IMAGE_TYPE');
  let img: Decoded;
  try {
    img = await deps.decode(file);
  } catch {
    // The browser could not read it; the server decides (and explains) if it is small enough.
    if (file.size <= PHOTO_SERVER_LIMIT) return file;
    throw new PhotoError('IMAGE_INVALID');
  }
  try {
    const size = fitWithin(img.width, img.height);
    if (!size.scaled && file.size <= PHOTO_KEEP_BYTES) return file;
    const out = await deps.encode(img.source, size.width, size.height, PHOTO_QUALITY);
    if (out.size > PHOTO_SERVER_LIMIT) throw new PhotoError('IMAGE_TOO_LARGE');
    return out;
  } finally {
    img.close();
  }
}

/** A file name for the upload: the original name with the extension the content now has. */
export function uploadName(file: File, prepared: Blob): string {
  if (prepared === file) return file.name || 'photo';
  return `${(file.name || 'photo').replace(/\.[A-Za-z0-9]{1,5}$/, '')}.jpg`;
}
