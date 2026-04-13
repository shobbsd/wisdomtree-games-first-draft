export interface TelemetryEvent<TPayload = unknown> {
  id: number;
  type: string;
  timestamp: number;
  payload: TPayload;
}

export interface EventListOptions {
  type?: string;
  limit?: number;
}

export class InMemoryEventSink {
  private events: TelemetryEvent[] = [];

  emit<TPayload>(type: string, payload: TPayload, timestamp = Date.now()): TelemetryEvent<TPayload> {
    const event: TelemetryEvent<TPayload> = {
      id: this.events.length + 1,
      type,
      timestamp,
      payload,
    };

    this.events.push(event);

    return event;
  }

  list(options: EventListOptions = {}): TelemetryEvent[] {
    const { type, limit = 100 } = options;
    const filtered = type ? this.events.filter((event) => event.type === type) : this.events;

    if (filtered.length <= limit) {
      return [...filtered];
    }

    return filtered.slice(filtered.length - limit);
  }

  countersByType(): Record<string, number> {
    return this.events.reduce<Record<string, number>>((acc, event) => {
      acc[event.type] = (acc[event.type] ?? 0) + 1;
      return acc;
    }, {});
  }
}
