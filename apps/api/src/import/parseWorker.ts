import { parseRecipeText, type Lang } from '@cookbook/recipe-core';
import { parentPort, workerData } from 'node:worker_threads';

/** Runs the recipe parser off the main thread so a slow parse can be stopped (D-033). */
type Job = { id: number; text: string; lang: Lang; busyMs?: number };
const testHooks = (workerData as { testHooks?: boolean } | null)?.testHooks === true;

parentPort!.on('message', (job: Job) => {
  try {
    // Tests only: simulate a parse that never finishes, to prove the time limit stops it.
    if (testHooks && job.busyMs) {
      const until = Date.now() + job.busyMs;
      while (Date.now() < until);
    }
    parentPort!.postMessage({
      id: job.id,
      ok: true,
      result: parseRecipeText(job.text, { fallbackLang: job.lang }),
    });
  } catch (err) {
    parentPort!.postMessage({
      id: job.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
