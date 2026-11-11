import type { AnalysisSummary, BaselineDto } from './types';

export interface EventMap {
  'analysis.saved': AnalysisSummary;
  'analysis.deleted': { id: string };
  'baseline.trained': BaselineDto;
  'baseline.deleted': { id: string };
}
export type EventName = keyof EventMap;
/** `ownerId` is set when authentication is enabled, so the gateway only pushes the event to that user. */
export type Listener = <K extends EventName>(event: K, payload: EventMap[K], ownerId?: string) => void;

/** Tiny typed pub/sub. The socket.io gateway subscribes; domain services publish. */
export class EventBus {
  private listeners = new Set<Listener>();
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  publish<K extends EventName>(event: K, payload: EventMap[K]): void {
    for (const l of this.listeners) {
      try {
        l(event, payload);
      } catch {
        /* a broken listener must not break a request */
      }
    }
  }
}
