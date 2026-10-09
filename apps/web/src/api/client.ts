export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

type ErrorBody = { error?: { code?: string; message?: string; request_id?: string } };

export type ApiClient = {
  request<T>(method: string, path: string, body?: unknown): Promise<T>;
};

export function createApiClient(opts: {
  baseUrl: string;
  getInitData: () => string;
  fetchImpl?: typeof fetch;
}): ApiClient {
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  return {
    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
      let res: Response;
      try {
        res = await doFetch(`${opts.baseUrl}${path}`, {
          method,
          headers: {
            Authorization: `tma ${opts.getInitData()}`,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch {
        throw new ApiError(0, 'NETWORK', 'Network error');
      }
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      let json: unknown = undefined;
      try {
        json = text ? JSON.parse(text) : undefined;
      } catch {
        /* non-JSON body */
      }
      if (!res.ok) {
        const e = (json as ErrorBody | undefined)?.error;
        throw new ApiError(
          res.status,
          e?.code ?? 'INTERNAL',
          e?.message ?? res.statusText,
          e?.request_id,
        );
      }
      return json as T;
    },
  };
}
