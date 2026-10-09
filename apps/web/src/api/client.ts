export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    /** What the API says in error.details (e.g. the missing parts for NOT_PUBLISHABLE). */
    readonly details?: unknown,
  ) {
    super(message);
  }
}

type ErrorBody = {
  error?: { code?: string; message?: string; request_id?: string; details?: unknown };
};

export type ApiClient = {
  /** JSON in, JSON out; or a FormData body (multipart, e.g. a photo for POST /media). */
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
      const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
      let res: Response;
      try {
        res = await doFetch(`${opts.baseUrl}${path}`, {
          method,
          headers: {
            Authorization: `tma ${opts.getInitData()}`,
            // FormData sets its own multipart Content-Type with the boundary.
            ...(body === undefined || isForm ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: isForm ? body : JSON.stringify(body) }),
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
          e?.details,
        );
      }
      return json as T;
    },
  };
}
