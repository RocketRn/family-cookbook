import { QueryClient } from '@tanstack/react-query';

/** The app's query settings; the screen tests use the same ones. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 15_000 },
      // S6-6 (D-059): without a connection a tap that needs the server fails at once and says
      // so, instead of waiting silently until the connection is back. Loads still wait (what was
      // loaded stays on screen, and the rest loads when the connection returns).
      mutations: { networkMode: 'always' },
    },
  });
}
