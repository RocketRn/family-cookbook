import type { Lang, ParsedRecipe } from '@cookbook/recipe-core';
import { Worker } from 'node:worker_threads';
import { AppError } from '../errors.js';

export interface ImportParser {
  parse(text: string, lang: Lang): Promise<ParsedRecipe>;
  close(): Promise<void>;
}

// In development and tests the worker runs the TypeScript source through tsx; in production the
// compiled JavaScript.
const FROM_SOURCE = import.meta.url.endsWith('.ts');
const WORKER_URL = new URL(FROM_SOURCE ? './parseWorker.ts' : './parseWorker.js', import.meta.url);
const EXEC_ARGV = FROM_SOURCE ? ['--import', 'tsx', '--conditions=source'] : [];

type Job = {
  id: number;
  text: string;
  lang: Lang;
  busyMs?: number;
  resolve: (r: ParsedRecipe) => void;
  reject: (e: Error) => void;
  timer?: NodeJS.Timeout;
};
type Reply =
  { id: number; ok: true; result: ParsedRecipe } | { id: number; ok: false; error: string };

export const importTimeout = () =>
  new AppError(
    422,
    'IMPORT_TIMEOUT',
    'The text could not be read in time. Try a shorter part of it.',
  );

/**
 * Hard time limit for POST /recipes/import (D-033). The parser is linear-time, but a worker that
 * goes past the limit is terminated (which stops it, unlike a timer on the main thread) and replaced.
 * Workers start on first use and are reused.
 */
export class WorkerParserPool implements ImportParser {
  private readonly idle: Worker[] = [];
  private readonly busy = new Map<Worker, Job>();
  private readonly queue: Job[] = [];
  private workers = 0;
  private nextId = 1;
  private closed = false;

  constructor(private readonly opts: { size: number; timeoutMs: number; testHooks?: boolean }) {}

  parse(text: string, lang: Lang, test?: { busyMs: number }): Promise<ParsedRecipe> {
    if (this.closed) return Promise.reject(new Error('parser pool is closed'));
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, text, lang, busyMs: test?.busyMs, resolve, reject });
      this.pump();
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const job of this.queue.splice(0)) job.reject(new Error('parser pool is closed'));
    const all = [...this.idle.splice(0), ...this.busy.keys()];
    for (const job of this.busy.values()) clearTimeout(job.timer);
    this.busy.clear();
    await Promise.all(all.map((w) => w.terminate()));
  }

  private spawn(): Worker {
    const w = new Worker(WORKER_URL, {
      execArgv: EXEC_ARGV,
      workerData: { testHooks: this.opts.testHooks === true },
    });
    this.workers++;
    w.on('message', (m: Reply) => this.finish(w, m));
    w.on('error', (err) => this.drop(w, err));
    return w;
  }

  private pump(): void {
    while (this.queue.length > 0 && (this.idle.length > 0 || this.workers < this.opts.size)) {
      const w = this.idle.pop() ?? this.spawn();
      const job = this.queue.shift()!;
      this.busy.set(w, job);
      job.timer = setTimeout(() => this.drop(w, importTimeout()), this.opts.timeoutMs);
      w.postMessage({ id: job.id, text: job.text, lang: job.lang, busyMs: job.busyMs });
    }
  }

  private finish(w: Worker, m: Reply): void {
    const job = this.busy.get(w);
    if (!job || job.id !== m.id) return;
    clearTimeout(job.timer);
    this.busy.delete(w);
    this.idle.push(w);
    if (m.ok) job.resolve(m.result);
    else job.reject(new AppError(422, 'IMPORT_FAILED', 'The text could not be read'));
    this.pump();
  }

  /** Timeout or a crashed worker: fail its job, stop it, start a fresh one for the queue. */
  private drop(w: Worker, err: Error): void {
    const job = this.busy.get(w);
    if (!job) return;
    clearTimeout(job.timer);
    this.busy.delete(w);
    this.workers--;
    void w.terminate();
    job.reject(err);
    this.pump();
  }
}
