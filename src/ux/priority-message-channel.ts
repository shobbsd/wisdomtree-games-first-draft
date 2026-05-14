export type MessagePriority = "P0" | "P1" | "P2";

export interface PriorityChannelMessage {
  id: string;
  state: string;
  event: string;
  priority: MessagePriority;
  copy: string;
  queueTimeoutFallback?: QueueTimeoutFallbackPayload;
}

export interface ActivePriorityChannelMessage extends PriorityChannelMessage {
  dwellMs: number;
  startedAtMs: number;
  expiresAtMs: number;
}

export interface PriorityChannelSnapshot {
  active: ActivePriorityChannelMessage | null;
  queued: PriorityChannelMessage[];
  activityFeed: ActivityFeedEntry[];
}

export interface QueueTimeoutFallback {
  id: "PM-QUEUE-TIMEOUT";
  state: "pre_match.queueing";
  event: "quick_match_queue_timeout_8s";
  priority: "P1";
  title: string;
  body: string;
  primaryCta: string;
  secondaryCta: string;
}

export interface QueueTimeoutFallbackPayload {
  title: string;
  body: string;
  primaryCta: string;
  secondaryCta: string;
}

export interface ActivityFeedEntry extends PriorityChannelMessage {
  receivedAtMs: number;
  reason: "p2_activity" | "p1_evicted" | "p2_evicted";
}

interface PriorityMessageChannelOptions {
  p1QueueLimit?: number;
  p2QueueLimit?: number;
  activityFeedLimit?: number;
}

interface InternalActiveMessage extends ActivePriorityChannelMessage {
  sequence: number;
}

interface QueuedMessage {
  message: PriorityChannelMessage;
  sequence: number;
}

const PRIORITY_RANK: Record<MessagePriority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
};

export const PRIORITY_DWELL_MS: Record<MessagePriority, number> = {
  P0: 1_800,
  P1: 1_500,
  P2: 1_500,
};

const QUEUE_TIMEOUT_FALLBACK_DEFAULTS: QueueTimeoutFallback = {
  id: "PM-QUEUE-TIMEOUT",
  state: "pre_match.queueing",
  event: "quick_match_queue_timeout_8s",
  priority: "P1",
  title: "Couldn’t find a match yet",
  body: "Still searching for an open lobby. Retry now or create a room.",
  primaryCta: "Retry",
  secondaryCta: "Create Room",
};

export function createQueueTimeoutFallback(): QueueTimeoutFallback {
  return { ...QUEUE_TIMEOUT_FALLBACK_DEFAULTS };
}

export class PriorityMessageChannel {
  private active: InternalActiveMessage | null = null;

  private readonly queued: QueuedMessage[] = [];

  private readonly activityFeed: ActivityFeedEntry[] = [];

  private readonly p1QueueLimit: number;

  private readonly p2QueueLimit: number;

  private readonly activityFeedLimit: number;

  private sequence = 0;

  constructor(options: PriorityMessageChannelOptions = {}) {
    this.p1QueueLimit = options.p1QueueLimit ?? 2;
    this.p2QueueLimit = options.p2QueueLimit ?? 2;
    this.activityFeedLimit = options.activityFeedLimit ?? 100;
  }

  publish(message: PriorityChannelMessage, nowMs: number): PriorityChannelSnapshot {
    this.advance(nowMs);

    if (message.priority === "P2") {
      this.recordActivityFeed(message, nowMs, "p2_activity");
    }

    if (isEliminationTerminalMessage(message)) {
      this.clearQueue();
      this.active = this.toActiveMessage(message, nowMs, this.sequence++);
      return this.getSnapshot();
    }

    if (!this.active) {
      this.active = this.toActiveMessage(message, nowMs, this.sequence++);
      return this.getSnapshot();
    }

    if (isHigherPriority(message.priority, this.active.priority)) {
      this.enqueue(this.toQueueMessage(this.active, this.active.sequence), nowMs);
      this.active = this.toActiveMessage(message, nowMs, this.sequence++);
      return this.getSnapshot();
    }

    if (message.priority === "P0" && this.active.priority === "P0") {
      this.active = this.toActiveMessage(message, nowMs, this.sequence++);
      return this.getSnapshot();
    }

    this.enqueue({ message: { ...message }, sequence: this.sequence++ }, nowMs);

    return this.getSnapshot();
  }

  publishQueueTimeoutFallback(nowMs: number): PriorityChannelSnapshot {
    const fallback = createQueueTimeoutFallback();
    return this.publish(
      {
        id: fallback.id,
        state: fallback.state,
        event: fallback.event,
        priority: fallback.priority,
        copy: fallback.title,
        queueTimeoutFallback: toQueueTimeoutFallbackPayload(fallback),
      },
      nowMs,
    );
  }

  advance(nowMs: number): PriorityChannelSnapshot {
    if (nowMs < 0) {
      throw new Error("nowMs cannot be negative");
    }

    while (this.active && nowMs >= this.active.expiresAtMs) {
      const nextMessage = this.dequeueNext();

      if (!nextMessage) {
        this.active = null;
        break;
      }

      this.active = this.toActiveMessage(nextMessage.message, this.active.expiresAtMs, nextMessage.sequence);
    }

    return this.getSnapshot();
  }

  getSnapshot(): PriorityChannelSnapshot {
    return {
      active: this.active ? this.toPublicActive(this.active) : null,
      queued: this.queued.map((entry) => ({ ...entry.message })),
      activityFeed: this.activityFeed.map((entry) => ({ ...entry })),
    };
  }

  private enqueue(entry: QueuedMessage, nowMs: number): void {
    this.queued.push(entry);
    this.evictOverflowingP1(nowMs);
    this.evictOverflowingP2(nowMs);
    this.queued.sort((left, right) => {
      const priorityDelta = PRIORITY_RANK[left.message.priority] - PRIORITY_RANK[right.message.priority];
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return left.sequence - right.sequence;
    });
  }

  private dequeueNext(): QueuedMessage | null {
    if (this.queued.length === 0) {
      return null;
    }

    const next = this.queued.shift();
    return next ?? null;
  }

  private toActiveMessage(
    message: PriorityChannelMessage,
    startedAtMs: number,
    sequence: number,
  ): InternalActiveMessage {
    const dwellMs = PRIORITY_DWELL_MS[message.priority];
    return {
      ...message,
      dwellMs,
      startedAtMs,
      expiresAtMs: startedAtMs + dwellMs,
      sequence,
    };
  }

  private toQueueMessage(active: InternalActiveMessage, sequence: number): QueuedMessage {
    return {
      sequence,
      message: {
        id: active.id,
        state: active.state,
        event: active.event,
        priority: active.priority,
        copy: active.copy,
        queueTimeoutFallback: active.queueTimeoutFallback
          ? { ...active.queueTimeoutFallback }
          : undefined,
      },
    };
  }

  private toPublicActive(active: InternalActiveMessage): ActivePriorityChannelMessage {
    return {
      id: active.id,
      state: active.state,
      event: active.event,
      priority: active.priority,
      copy: active.copy,
      queueTimeoutFallback: active.queueTimeoutFallback
        ? { ...active.queueTimeoutFallback }
        : undefined,
      dwellMs: active.dwellMs,
      startedAtMs: active.startedAtMs,
      expiresAtMs: active.expiresAtMs,
    };
  }

  private evictOverflowingP1(nowMs: number): void {
    const p1Entries = this.queued
      .filter((entry) => entry.message.priority === "P1")
      .sort((left, right) => left.sequence - right.sequence);

    while (p1Entries.length > this.p1QueueLimit) {
      const evicted = p1Entries.shift();
      if (!evicted) {
        break;
      }

      const evictedIndex = this.queued.findIndex((entry) => entry.sequence === evicted.sequence);
      if (evictedIndex >= 0) {
        const [removed] = this.queued.splice(evictedIndex, 1);
        this.recordActivityFeed(removed.message, nowMs, "p1_evicted");
      }
    }
  }

  private evictOverflowingP2(nowMs: number): void {
    const p2Entries = this.queued
      .filter((entry) => entry.message.priority === "P2")
      .sort((left, right) => left.sequence - right.sequence);

    while (p2Entries.length > this.p2QueueLimit) {
      const evicted = p2Entries.shift();
      if (!evicted) {
        break;
      }

      const evictedIndex = this.queued.findIndex((entry) => entry.sequence === evicted.sequence);
      if (evictedIndex >= 0) {
        const [removed] = this.queued.splice(evictedIndex, 1);
        this.recordActivityFeed(removed.message, nowMs, "p2_evicted");
      }
    }
  }

  private recordActivityFeed(
    message: PriorityChannelMessage,
    receivedAtMs: number,
    reason: ActivityFeedEntry["reason"],
  ): void {
    this.activityFeed.push({
      ...message,
      receivedAtMs,
      reason,
    });

    while (this.activityFeed.length > this.activityFeedLimit) {
      this.activityFeed.shift();
    }
  }

  private clearQueue(): void {
    this.queued.splice(0, this.queued.length);
  }
}

function isHigherPriority(candidate: MessagePriority, baseline: MessagePriority): boolean {
  return PRIORITY_RANK[candidate] < PRIORITY_RANK[baseline];
}

function isEliminationTerminalMessage(message: PriorityChannelMessage): boolean {
  return (
    message.id === "IR-ELIMINATED" ||
    message.state === "in_run.eliminated" ||
    message.event === "player_eliminated"
  );
}

function toQueueTimeoutFallbackPayload(fallback: QueueTimeoutFallback): QueueTimeoutFallbackPayload {
  return {
    title: fallback.title,
    body: fallback.body,
    primaryCta: fallback.primaryCta,
    secondaryCta: fallback.secondaryCta,
  };
}
