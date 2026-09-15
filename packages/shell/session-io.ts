/** Serialize durable work per document. A manual save waits for an in-flight
 * recovery snapshot, so neither an old snapshot nor a close can race a save. */
export interface IoSession {
  busy: boolean;
  pending?: Promise<void>;
}
export function withSessionIo<T>(
  session: IoSession,
  task: () => Promise<T>,
): Promise<T> {
  const work = (session.pending ?? Promise.resolve()).then(task);
  const marker = work
    .then(
      () => {},
      () => {},
    )
    .finally(() => {
      if (session.pending === marker) {
        session.pending = undefined;
        session.busy = false;
      }
    });
  session.pending = marker;
  session.busy = true;
  return work;
}
