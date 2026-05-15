// Global pub/sub bridge between the poller (instrumentation context)
// and the SSE route handler. Using global so both share the same Set
// across Next.js module boundaries in the same Node.js process.

type Subscriber = (json: string) => void;

declare global {
  // eslint-disable-next-line no-var
  var __luxSubscribers: Set<Subscriber> | undefined;
}

if (!global.__luxSubscribers) {
  global.__luxSubscribers = new Set<Subscriber>();
}

export function publish(json: string) {
  global.__luxSubscribers!.forEach(fn => fn(json));
}

export function subscribe(fn: Subscriber): () => void {
  global.__luxSubscribers!.add(fn);
  return () => global.__luxSubscribers!.delete(fn);
}
