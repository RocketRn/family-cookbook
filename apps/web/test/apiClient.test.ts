import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from '../src/api/client';

const res = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

describe('api client', () => {
  it('sends Authorization: tma <initData> and parses JSON', async () => {
    const f = vi.fn().mockResolvedValue(res(200, { ok: 1 }));
    const c = createApiClient({ baseUrl: '/api', getInitData: () => 'a=b&hash=c', fetchImpl: f });
    await expect(c.request('GET', '/me')).resolves.toEqual({ ok: 1 });
    expect(f).toHaveBeenCalledWith('/api/me', {
      method: 'GET',
      headers: { Authorization: 'tma a=b&hash=c' },
    });
  });

  it('sends a JSON body with a content type', async () => {
    const f = vi.fn().mockResolvedValue(res(201, { id: 'x' }));
    const c = createApiClient({ baseUrl: '', getInitData: () => 'i', fetchImpl: f });
    await c.request('POST', '/books', { title: 'T' });
    const init = f.mock.calls[0]![1] as RequestInit;
    expect(init.body).toBe('{"title":"T"}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('maps the server error shape to ApiError', async () => {
    const f = vi
      .fn()
      .mockResolvedValue(
        res(409, { error: { code: 'KEEPER_CANNOT_LEAVE', message: 'm', request_id: 'r1' } }),
      );
    const c = createApiClient({ baseUrl: '', getInitData: () => 'i', fetchImpl: f });
    await expect(c.request('POST', '/books/leave')).rejects.toMatchObject({
      status: 409,
      code: 'KEEPER_CANNOT_LEAVE',
      requestId: 'r1',
    });
  });

  it('handles 204, non-JSON error bodies and network failures', async () => {
    const c204 = createApiClient({
      baseUrl: '',
      getInitData: () => 'i',
      fetchImpl: vi.fn().mockResolvedValue(res(204)),
    });
    await expect(c204.request('POST', '/x')).resolves.toBeUndefined();

    const html = vi.fn().mockResolvedValue(new Response('<html>', { status: 502 }));
    const c502 = createApiClient({ baseUrl: '', getInitData: () => 'i', fetchImpl: html });
    await expect(c502.request('GET', '/x')).rejects.toMatchObject({
      status: 502,
      code: 'INTERNAL',
    });

    const down = createApiClient({
      baseUrl: '',
      getInitData: () => 'i',
      fetchImpl: vi.fn().mockRejectedValue(new TypeError('fail')),
    });
    await expect(down.request('GET', '/x')).rejects.toBeInstanceOf(ApiError);
    await expect(down.request('GET', '/x')).rejects.toMatchObject({ code: 'NETWORK', status: 0 });
  });
});
