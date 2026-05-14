import { describe, expect, it } from "vitest";

import {
  PriorityMessageChannel,
  PRIORITY_DWELL_MS,
  createQueueTimeoutFallback,
  type PriorityChannelMessage,
} from "../src/ux/priority-message-channel";

function buildMessage(
  id: string,
  priority: PriorityChannelMessage["priority"],
  copy = id,
): PriorityChannelMessage {
  return {
    id,
    state: "in_run.urgent_alert",
    event: id,
    priority,
    copy,
  };
}

describe("priority message channel", () => {
  it("preempts lower-priority active messages when P0 arrives", () => {
    const channel = new PriorityMessageChannel();

    channel.publish(buildMessage("rank-up", "P1", "Rank Up"), 0);
    channel.publish(buildMessage("clearance", "P1", "Low Clearance"), 100);

    const preempted = channel.publish(buildMessage("hazard", "P0", "Critical Rise Speed"), 200);

    expect(preempted.active?.id).toBe("hazard");
    expect(preempted.active?.priority).toBe("P0");
    expect(preempted.queued.map((message) => message.id)).toEqual(["rank-up", "clearance"]);
  });

  it("keeps P0 active while lower-priority messages queue", () => {
    const channel = new PriorityMessageChannel();

    channel.publish(buildMessage("hazard", "P0", "Ground Rising Faster"), 0);
    const snapshot = channel.publish(buildMessage("clearance", "P1", "Low Clearance"), 100);

    expect(snapshot.active?.id).toBe("hazard");
    expect(snapshot.queued.map((message) => message.id)).toEqual(["clearance"]);
  });

  it("uses locked dwell timing and advances to queued alerts on expiry", () => {
    const channel = new PriorityMessageChannel();

    channel.publish(buildMessage("hazard", "P0", "Jump Now"), 0);
    channel.publish(buildMessage("clearance", "P1", "Low Clearance"), 10);

    const afterP0 = channel.advance(PRIORITY_DWELL_MS.P0);
    expect(afterP0.active?.id).toBe("clearance");
    expect(afterP0.active?.dwellMs).toBe(PRIORITY_DWELL_MS.P1);

    const cleared = channel.advance(PRIORITY_DWELL_MS.P0 + PRIORITY_DWELL_MS.P1);
    expect(cleared.active).toBeNull();
    expect(cleared.queued).toHaveLength(0);
  });

  it("returns queue-timeout fallback defaults with P1 priority", () => {
    const fallback = createQueueTimeoutFallback();

    expect(fallback).toEqual({
      id: "PM-QUEUE-TIMEOUT",
      state: "pre_match.queueing",
      event: "quick_match_queue_timeout_8s",
      priority: "P1",
      title: "Couldn’t find a match yet",
      body: "Still searching for an open lobby. Retry now or create a room.",
      primaryCta: "Retry",
      secondaryCta: "Create Room",
    });
  });

  it("preserves queue-timeout structured payload through publish and queueing paths", () => {
    const channel = new PriorityMessageChannel();

    const fallbackSnapshot = channel.publishQueueTimeoutFallback(10);
    expect(fallbackSnapshot.active).toMatchObject({
      id: "PM-QUEUE-TIMEOUT",
      priority: "P1",
      copy: "Couldn’t find a match yet",
      queueTimeoutFallback: {
        title: "Couldn’t find a match yet",
        body: "Still searching for an open lobby. Retry now or create a room.",
        primaryCta: "Retry",
        secondaryCta: "Create Room",
      },
    });

    const preempted = channel.publish(buildMessage("hazard", "P0", "Critical Rise Speed"), 20);
    const queuedFallback = preempted.queued.find((message) => message.id === "PM-QUEUE-TIMEOUT");
    expect(queuedFallback).toMatchObject({
      queueTimeoutFallback: {
        title: "Couldn’t find a match yet",
        body: "Still searching for an open lobby. Retry now or create a room.",
        primaryCta: "Retry",
        secondaryCta: "Create Room",
      },
    });
  });

  it("bounds the P1 queue and evicts oldest entries deterministically under burst load", () => {
    const channel = new PriorityMessageChannel({ p1QueueLimit: 2 });

    channel.publish(buildMessage("hazard", "P0", "Critical Rise Speed"), 0);
    channel.publish(buildMessage("p1-a", "P1", "A"), 10);
    channel.publish(buildMessage("p1-b", "P1", "B"), 20);
    const burst = channel.publish(buildMessage("p1-c", "P1", "C"), 30);

    expect(burst.queued.map((message) => message.id)).toEqual(["p1-b", "p1-c"]);
  });

  it("renders P2 toasts on the active lane and records activity feed entries", () => {
    const channel = new PriorityMessageChannel();

    const snapshot = channel.publish(buildMessage("joined", "P2", "Joined Lobby"), 0);

    expect(snapshot.active?.id).toBe("joined");
    expect(snapshot.active?.priority).toBe("P2");
    expect(snapshot.active?.dwellMs).toBe(PRIORITY_DWELL_MS.P2);
    expect(snapshot.queued).toHaveLength(0);
    expect(snapshot.activityFeed).toHaveLength(1);
    expect(snapshot.activityFeed[0]).toMatchObject({
      id: "joined",
      priority: "P2",
      copy: "Joined Lobby",
    });
  });

  it("queues and replays newest two P2 toasts after a blocking P0 clears", () => {
    const channel = new PriorityMessageChannel({ p2QueueLimit: 2 });

    channel.publish(buildMessage("hazard", "P0", "Critical Rise Speed"), 0);
    channel.publish(buildMessage("rank-1", "P2", "Rank Up #4"), 10);
    channel.publish(buildMessage("rank-2", "P2", "Rank Up #3"), 20);
    const whileBlocked = channel.publish(buildMessage("rank-3", "P2", "Rank Up #2"), 30);

    expect(whileBlocked.active?.id).toBe("hazard");
    expect(whileBlocked.queued.map((message) => message.id)).toEqual(["rank-2", "rank-3"]);

    const replayFirst = channel.advance(PRIORITY_DWELL_MS.P0);
    expect(replayFirst.active?.id).toBe("rank-2");
    expect(replayFirst.active?.dwellMs).toBe(PRIORITY_DWELL_MS.P2);

    const replaySecond = channel.advance(PRIORITY_DWELL_MS.P0 + PRIORITY_DWELL_MS.P2);
    expect(replaySecond.active?.id).toBe("rank-3");
  });

  it("clears queued toasts when HUD-ELIMINATED arrives", () => {
    const channel = new PriorityMessageChannel({ p2QueueLimit: 2 });

    channel.publish(buildMessage("hazard", "P0", "Jump Now"), 0);
    channel.publish(buildMessage("rank-1", "P2", "Rank Up #4"), 10);

    const eliminated = channel.publish(
      {
        id: "IR-ELIMINATED",
        state: "in_run.eliminated",
        event: "player_eliminated",
        priority: "P0",
        copy: "Eliminated",
      },
      20,
    );

    expect(eliminated.active?.id).toBe("IR-ELIMINATED");
    expect(eliminated.queued).toHaveLength(0);

    const afterElimination = channel.advance(20 + PRIORITY_DWELL_MS.P0);
    expect(afterElimination.active).toBeNull();
  });
});
