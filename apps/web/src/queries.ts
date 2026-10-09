import { ApiError } from './api/client';
import { getCurrentBook } from './api/endpoints';

/** The current book, or null when the user is not in one (NOT_IN_BOOK is a state, not an error). */
export const bookQuery = {
  queryKey: ['book'] as const,
  queryFn: async () => {
    try {
      return await getCurrentBook();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NOT_IN_BOOK') return null;
      throw err;
    }
  },
};
