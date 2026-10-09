import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { S3Storage } from '../src/storage/storage.js';

/**
 * Google Cloud Storage through its S3-compatible XML API with HMAC keys (owner's deployment
 * choice; D-045). A local stand-in that behaves like GCS where it differs from S3 in what we use:
 * - no multi-object delete (POST ?delete): GCS answers 501 NotImplemented;
 * - the AWS SDK's newer "flexible checksum" headers and aws-chunked uploads are refused.
 * Real GCS is checked by the S3 contract test pointed at the bucket (docs/DEPLOY-GCP.ru.md).
 */
type Obj = { body: Buffer; type: string };
const objects = new Map<string, Obj>();
const refused: string[] = [];
let server: http.Server;
let endpoint: string;

const xmlError = (res: http.ServerResponse, status: number, code: string) => {
  res.writeHead(status, { 'content-type': 'application/xml' });
  res.end(`<?xml version="1.0"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`);
};

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://gcs.local');
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const checksumHeaders = Object.keys(req.headers).filter(
      (h) =>
        h.startsWith('x-amz-checksum-') ||
        h === 'x-amz-sdk-checksum-algorithm' ||
        h === 'x-amz-trailer',
    );
    const checksumQuery = [...url.searchParams.keys()].filter((k) =>
      k.startsWith('x-amz-checksum'),
    );
    if (
      checksumHeaders.length ||
      checksumQuery.length ||
      /aws-chunked/.test(String(req.headers['content-encoding'] ?? ''))
    ) {
      refused.push(
        `${req.method} ${[...checksumHeaders, ...checksumQuery].join(',') || 'aws-chunked'}`,
      );
      return xmlError(res, 400, 'InvalidArgument');
    }
    if (req.method === 'POST' && url.searchParams.has('delete')) {
      refused.push('POST ?delete (multi-object delete)');
      return xmlError(res, 501, 'NotImplemented');
    }
    const signed =
      String(req.headers.authorization ?? '').startsWith('AWS4-HMAC-SHA256') ||
      url.searchParams.get('X-Amz-Algorithm') === 'AWS4-HMAC-SHA256';
    if (!signed) return xmlError(res, 403, 'AccessDenied');
    // Path-style: /<bucket>/<key>
    const key = decodeURIComponent(url.pathname);
    if (req.method === 'PUT') {
      objects.set(key, { body, type: String(req.headers['content-type'] ?? '') });
      res.writeHead(200, { etag: '"x"' });
      return res.end();
    }
    if (req.method === 'GET') {
      const o = objects.get(key);
      if (!o) return xmlError(res, 404, 'NoSuchKey');
      res.writeHead(200, { 'content-type': o.type, 'content-length': o.body.length });
      return res.end(o.body);
    }
    if (req.method === 'DELETE') {
      objects.delete(key);
      res.writeHead(204);
      return res.end();
    }
    return xmlError(res, 405, 'MethodNotAllowed');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('S3Storage with Google Cloud Storage (XML API, HMAC keys)', () => {
  it('stores, reads, signs a link and deletes without anything GCS refuses', async () => {
    const storage = new S3Storage({
      endpoint,
      publicEndpoint: endpoint,
      region: 'auto',
      bucket: 'family-cookbook-media',
      accessKey: 'GOOG1EFAKEFAKEFAKEFAKE',
      secretKey: 'fake-hmac-secret-for-tests-only',
      forcePathStyle: true,
    });
    const keys = ['media/a/full.jpg', 'media/a/thumb.jpg', 'media/b/full.jpg'];
    for (const k of keys) await storage.put(k, Buffer.from(`bytes of ${k}`), 'image/jpeg');
    expect((await storage.get(keys[0]!))?.toString()).toBe('bytes of media/a/full.jpg');
    expect(await storage.get('media/none.jpg')).toBeNull();

    const link = await storage.url(keys[0]!);
    expect(link).toContain('X-Amz-Signature=');
    expect(link).not.toContain('x-amz-checksum');
    const res = await fetch(link);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('bytes of media/a/full.jpg');

    await storage.delete(keys);
    for (const k of keys) expect(await storage.get(k)).toBeNull();
    expect(refused).toEqual([]);
  });
});
