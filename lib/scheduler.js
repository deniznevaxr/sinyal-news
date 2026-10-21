// Runs every job on its own interval with bounded concurrency. Emits:
//   'status' (jobState)  – a job started/finished
//   'result' ({ job, fresh, boards, backfill }) – a job delivered data
//   'idle'               – nothing running or queued
import { EventEmitter } from 'node:events';
import { describeError } from './http.js';

const JOB_TIMEOUT = 6 * 60e3;

export class Scheduler extends EventEmitter {
  constructor(jobs, store, ctx, { concurrency = 6 } = {}) {
    super();
    this.jobs = jobs;
    this.store = store;
    this.ctx = ctx;
    this.concurrency = concurrency;
    this.queue = [];
    this.active = 0;
  }

  start() {
    const now = Date.now();
    for (const job of this.jobs) {
      const st = this.store.jobs[job.id];
      // Respect the cache on restart: only refetch what is actually stale.
      job.nextRun = st?.lastRun && st.ok ? Math.max(now, st.lastRun + job.every * 60e3) : now;
    }
    this.timer = setInterval(() => this.tick(), 5000);
    this.tick();
  }

  tick() {
    const now = Date.now();
    const due = this.jobs.filter(j => !j.running && !this.queue.includes(j) && j.nextRun <= now);
    this.queue.push(...due);
    if (due.length) this.emit('queue');
    this.pump();
  }

  pump() {
    while (this.active < this.concurrency && this.queue.length) this.runJob(this.queue.shift());
  }

  async runJob(job) {
    job.running = true;
    this.active++;
    const st = (this.store.jobs[job.id] ||= {});
    this.emit('status', this.publicState(job));
    const t0 = Date.now();
    const backfill = !st.lastOk;
    let timer;
    try {
      const result = await Promise.race([
        job.run(job, this.ctx),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('iş zaman aşımına uğradı')), JOB_TIMEOUT); }),
      ]);
      const fresh = this.store.ingest(job, result);
      Object.assign(st, { ok: true, error: null, lastOk: Date.now(), count: result.items?.length ?? 0, fresh: fresh.length, note: result.note || '' });
      this.emit('result', { job, fresh, boards: Object.keys(result.boards || {}), backfill });
    } catch (e) {
      Object.assign(st, { ok: false, error: describeError(e) });
    } finally {
      clearTimeout(timer);
      st.lastRun = Date.now();
      st.ms = st.lastRun - t0;
      job.running = false;
      this.active--;
      // Failed sources retry sooner than their normal cadence.
      job.nextRun = st.lastRun + (st.ok ? job.every : Math.min(job.every, 8)) * 60e3;
      this.emit('status', this.publicState(job));
      this.pump();
      if (!this.active && !this.queue.length) this.emit('idle');
    }
  }

  runNow(ids) {
    for (const j of this.jobs) if (!ids || ids.includes(j.id)) j.nextRun = 0;
    this.tick();
  }

  get busy() {
    return { active: this.active, queued: this.queue.length, total: this.jobs.length };
  }

  publicState(job) {
    const st = this.store.jobs[job.id] || {};
    return {
      id: job.id, name: job.name, short: job.short, group: job.group, every: job.every, url: job.url || null,
      running: !!job.running, queued: this.queue.includes(job),
      ok: st.ok ?? null, error: st.error || null, note: st.note || '',
      lastRun: st.lastRun || null, lastOk: st.lastOk || null, ms: st.ms || null,
      count: st.count ?? null, fresh: st.fresh ?? null, nextRun: job.nextRun || null,
    };
  }

  snapshot() {
    return this.jobs.map(j => this.publicState(j));
  }
}
