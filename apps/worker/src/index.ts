// Timer and outbox worker. Runs as a separate process from the API.
// Sprint 1 ships only the process skeleton; the timer poller (BE-09) and the
// outbox sender (BE-08) arrive in Sprint 4.
const heartbeatMs = 30_000;

console.log(
  JSON.stringify({ level: 'info', msg: 'worker started (no jobs registered in Sprint 1)' }),
);

const timer = setInterval(() => {
  console.log(JSON.stringify({ level: 'debug', msg: 'worker heartbeat' }));
}, heartbeatMs);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    console.log(JSON.stringify({ level: 'info', msg: `worker stopped on ${signal}` }));
    process.exit(0);
  });
}
