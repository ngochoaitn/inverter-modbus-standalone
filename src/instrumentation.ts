export async function register() {
  // Only run in the Node.js server runtime, not in Edge or during build
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startPoller } = await import('./lib/poller');
    startPoller();
  }
}
