import type { ProbeEvent } from '../types';

export function isProbeMessage(data: unknown): data is {
  source: 'playable-validator-probe';
  type: ProbeEvent['type'];
  detail: Record<string, unknown>;
  at: number;
} {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { source?: string }).source === 'playable-validator-probe' &&
    typeof (data as { type?: string }).type === 'string'
  );
}

export function listenProbeEvents(
  handler: (event: ProbeEvent) => void,
): () => void {
  const onMessage = (ev: MessageEvent) => {
    if (!isProbeMessage(ev.data)) return;
    handler({
      type: ev.data.type,
      detail: ev.data.detail || {},
      at: ev.data.at || Date.now(),
    });
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}
