import sharp from 'sharp';

/** Builds a multipart/form-data body with one file part. */
export function multipart(
  buf: Buffer,
  opts: { field?: string; filename?: string; contentType?: string } = {},
) {
  const boundary = '----cookbook-test-boundary';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${opts.field ?? 'file'}"; filename="${opts.filename ?? 'photo.jpg'}"\r\n` +
      `Content-Type: ${opts.contentType ?? 'image/jpeg'}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, buf, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

const canvas = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } } });

/** A JPEG that carries EXIF (camera, copyright) and orientation 6 (stored sideways). */
export const jpegWithExif = (width = 400, height = 200) =>
  canvas(width, height)
    .withExif({ IFD0: { Make: 'TestCam', Model: 'Phone 1', Copyright: 'Private family photo' } })
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer();
export const png = (width = 300, height = 300) => canvas(width, height).png().toBuffer();
export const webp = (width = 300, height = 300) => canvas(width, height).webp().toBuffer();
export const gif = (width = 10, height = 10) => canvas(width, height).gif().toBuffer();
/** Big but tiny on disk: 8000 x 8000 single-colour PNG (a "decompression bomb" by our limit). */
export const hugePng = () => canvas(8000, 8000).png({ compressionLevel: 9 }).toBuffer();
/** The first bytes of an iPhone HEIC file (ftyp brand heic) followed by junk. */
export const heicLike = () =>
  Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from('ftypheic', 'latin1'),
    Buffer.from('mif1heic'),
    Buffer.alloc(2048, 7),
  ]);
