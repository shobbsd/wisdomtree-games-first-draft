import type { TelemetryEvent } from "../telemetry/event-sink.js";

type SchemaPrimitive = string | number | boolean | null;

type SchemaNode =
  | StringSchemaNode
  | NumberSchemaNode
  | BooleanSchemaNode
  | LiteralSchemaNode
  | NullSchemaNode
  | ArraySchemaNode
  | ObjectSchemaNode
  | UnionSchemaNode;

interface StringSchemaNode {
  type: "string";
  minLength?: number;
  enum?: readonly string[];
}

interface NumberSchemaNode {
  type: "number";
  integer?: boolean;
  minimum?: number;
}

interface BooleanSchemaNode {
  type: "boolean";
}

interface LiteralSchemaNode {
  type: "literal";
  value: SchemaPrimitive;
}

interface NullSchemaNode {
  type: "null";
}

interface ArraySchemaNode {
  type: "array";
  items: SchemaNode;
  minItems?: number;
}

interface ObjectSchemaNode {
  type: "object";
  required: readonly string[];
  properties: Readonly<Record<string, SchemaNode>>;
  additionalProperties?: boolean;
}

interface UnionSchemaNode {
  type: "union";
  anyOf: readonly SchemaNode[];
}

export interface SessionIdentityTokenClaimsV1 {
  v: 1;
  sid: string;
  pid: string;
  exp: number;
}

export interface EventSchemaDefinition {
  schemaId: string;
  version: "v1";
  description: string;
  payload: SchemaNode;
}

export interface AnalyticsEventRequirement {
  id: string;
  description: string;
  eventTypes: readonly string[];
  minCount: number;
}

export interface SchemaValidationIssue {
  path: string;
  message: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: SchemaValidationIssue[];
}

export interface EventPayloadValidationResult extends SchemaValidationResult {
  eventType: string;
  schemaId: string | null;
  schemaVersion: string | null;
}

export interface RequiredEventSetValidationResult {
  valid: boolean;
  missingRequirements: string[];
  invalidEvents: Array<{
    requirementId: string;
    eventType: string;
    eventIndex: number;
    schemaId: string | null;
    errors: SchemaValidationIssue[];
  }>;
}

export const WIS511_SCHEMA_REGISTRY_VERSION = "1.0.0" as const;

export const WIS511_SESSION_IDENTITY_TOKEN_SCHEMA_ID = "session.identity.player_auth_token.v1" as const;

export const WIS511_EVENT_TYPES = Object.freeze({
  sessionLifecycleCreated: "session.lifecycle.created",
  sessionLifecyclePlayerJoined: "session.lifecycle.player_joined",
  sessionInputAccepted: "session.input.accepted",
  sessionLeaderboardUpdated: "session.leaderboard.updated",
  sessionFlowStateUpdated: "session.flow_state.updated",
  sessionLifecycleTransportConnectFailed: "session.lifecycle.transport_connect_failed",
  sessionSyncDesyncDetected: "session.sync.desync_detected",
  sessionIntegrityViolation: "session.integrity.violation",
  sessionIntegrityEscalated: "session.integrity.escalated",
  risingGroundEliminationTriggered: "rg.elimination.triggered",
} as const);

const NON_EMPTY_STRING: StringSchemaNode = {
  type: "string",
  minLength: 1,
};

const POSITIVE_INT: NumberSchemaNode = {
  type: "number",
  integer: true,
  minimum: 1,
};

const NON_NEGATIVE_INT: NumberSchemaNode = {
  type: "number",
  integer: true,
  minimum: 0,
};

const NULL_SCHEMA: NullSchemaNode = {
  type: "null",
};

const BOOLEAN_SCHEMA: BooleanSchemaNode = {
  type: "boolean",
};

const NULLABLE_STRING: UnionSchemaNode = {
  type: "union",
  anyOf: [NON_EMPTY_STRING, NULL_SCHEMA],
};

const NULLABLE_NON_NEGATIVE_INT: UnionSchemaNode = {
  type: "union",
  anyOf: [NON_NEGATIVE_INT, NULL_SCHEMA],
};

const ELIMINATION_REASON_SCHEMA: UnionSchemaNode = {
  type: "union",
  anyOf: [
    {
      type: "string",
      enum: ["ground", "disconnected"],
    },
    NULL_SCHEMA,
  ],
};

const RANK_DELTA_SCHEMA: UnionSchemaNode = {
  type: "union",
  anyOf: [{ type: "number", integer: true }, NULL_SCHEMA],
};

const FLOW_STATE_PHASE_SCHEMA: StringSchemaNode = {
  type: "string",
  enum: ["lobby", "in_round", "results"],
};

const RESULTS_LIFECYCLE_STATE_SCHEMA: UnionSchemaNode = {
  type: "union",
  anyOf: [
    { type: "string", enum: ["RESULTS-NORMAL", "RESULTS-PENDING", "RESULTS-RETRYING", "RESULTS-FAILED"] },
    NULL_SCHEMA,
  ],
};

const INTEGRITY_CATEGORY_SCHEMA: StringSchemaNode = {
  type: "string",
  enum: ["input", "movement", "time_drift"],
};

const INTEGRITY_SEVERITY_SCHEMA: StringSchemaNode = {
  type: "string",
  enum: ["warn", "elevated", "critical"],
};

const INTEGRITY_ACTION_SCHEMA: StringSchemaNode = {
  type: "string",
  enum: ["reject_input", "sanitize_state", "quarantine_player", "quarantine_session", "observe_only"],
};

const SESSION_IDENTITY_TOKEN_SCHEMA: ObjectSchemaNode = {
  type: "object",
  required: ["v", "sid", "pid", "exp"],
  additionalProperties: false,
  properties: {
    v: { type: "literal", value: 1 },
    sid: NON_EMPTY_STRING,
    pid: NON_EMPTY_STRING,
    exp: POSITIVE_INT,
  },
};

const LEADERBOARD_SNAPSHOT_ENTRY_SCHEMA: ObjectSchemaNode = {
  type: "object",
  required: [
    "playerId",
    "rank",
    "score",
    "survivalMs",
    "connected",
    "isEliminated",
    "eliminationReason",
    "isTie",
    "placementToken",
  ],
  properties: {
    playerId: NON_EMPTY_STRING,
    rank: POSITIVE_INT,
    score: NON_NEGATIVE_INT,
    survivalMs: NON_NEGATIVE_INT,
    connected: BOOLEAN_SCHEMA,
    isEliminated: BOOLEAN_SCHEMA,
    eliminationReason: ELIMINATION_REASON_SCHEMA,
    isTie: BOOLEAN_SCHEMA,
    placementToken: NON_EMPTY_STRING,
  },
};

const LEADERBOARD_UPDATE_ENTRY_SCHEMA: ObjectSchemaNode = {
  type: "object",
  required: [
    "playerId",
    "kind",
    "previousRank",
    "rank",
    "rankDelta",
    "previousScore",
    "score",
    "scoreDelta",
    "previousSurvivalMs",
    "survivalMs",
    "survivalDeltaMs",
    "changedFields",
  ],
  properties: {
    playerId: NON_EMPTY_STRING,
    kind: {
      type: "string",
      enum: ["joined", "left", "updated"],
    },
    previousRank: NULLABLE_NON_NEGATIVE_INT,
    rank: NULLABLE_NON_NEGATIVE_INT,
    rankDelta: RANK_DELTA_SCHEMA,
    previousScore: NULLABLE_NON_NEGATIVE_INT,
    score: NULLABLE_NON_NEGATIVE_INT,
    scoreDelta: RANK_DELTA_SCHEMA,
    previousSurvivalMs: NULLABLE_NON_NEGATIVE_INT,
    survivalMs: NULLABLE_NON_NEGATIVE_INT,
    survivalDeltaMs: RANK_DELTA_SCHEMA,
    changedFields: {
      type: "array",
      minItems: 1,
      items: {
        type: "string",
        enum: [
          "rank",
          "score",
          "survivalMs",
          "connected",
          "isEliminated",
          "eliminationReason",
          "isTie",
          "placementToken",
        ],
      },
    },
  },
};

export const WIS511_EVENT_SCHEMAS: Readonly<Record<string, EventSchemaDefinition>> = Object.freeze({
  [WIS511_EVENT_TYPES.sessionLifecycleCreated]: {
    schemaId: "session.lifecycle.created.v1",
    version: "v1",
    description: "Authoritative room creation lifecycle checkpoint.",
    payload: {
      type: "object",
      required: ["sessionId", "nowMs"],
      properties: {
        sessionId: NON_EMPTY_STRING,
        nowMs: NON_NEGATIVE_INT,
      },
    },
  },
  [WIS511_EVENT_TYPES.sessionLifecyclePlayerJoined]: {
    schemaId: "session.lifecycle.player_joined.v1",
    version: "v1",
    description: "Authenticated player admission into an authoritative room session.",
    payload: {
      type: "object",
      required: ["sessionId", "playerId", "nowMs"],
      properties: {
        sessionId: NON_EMPTY_STRING,
        playerId: NON_EMPTY_STRING,
        nowMs: NON_NEGATIVE_INT,
      },
    },
  },
  [WIS511_EVENT_TYPES.sessionInputAccepted]: {
    schemaId: "session.input.accepted.v1",
    version: "v1",
    description: "Authoritative input acceptance event used as baseline UX analytics signal.",
    payload: {
      type: "object",
      required: ["sessionId", "playerId", "sequence", "result"],
      properties: {
        sessionId: NON_EMPTY_STRING,
        playerId: NON_EMPTY_STRING,
        sequence: POSITIVE_INT,
        result: {
          type: "object",
          required: ["accepted"],
          additionalProperties: false,
          properties: {
            accepted: { type: "literal", value: true },
          },
        },
      },
    },
  },
  [WIS511_EVENT_TYPES.sessionLeaderboardUpdated]: {
    schemaId: "session.leaderboard.updated.v1",
    version: "v1",
    description: "Authoritative leaderboard snapshot + incremental rank/elimination deltas.",
    payload: {
      type: "object",
      required: ["sessionId", "phase", "revision", "tick", "updatedAt", "reason", "snapshot", "updates"],
      properties: {
        sessionId: NON_EMPTY_STRING,
        phase: FLOW_STATE_PHASE_SCHEMA,
        revision: POSITIVE_INT,
        tick: NON_NEGATIVE_INT,
        updatedAt: NON_NEGATIVE_INT,
        reason: NON_EMPTY_STRING,
        snapshot: {
          type: "array",
          items: LEADERBOARD_SNAPSHOT_ENTRY_SCHEMA,
        },
        updates: {
          type: "array",
          items: LEADERBOARD_UPDATE_ENTRY_SCHEMA,
        },
      },
    },
  },
  [WIS511_EVENT_TYPES.sessionFlowStateUpdated]: {
    schemaId: "session.flow_state.updated.v1",
    version: "v1",
    description: "Authoritative state transition event for UX/runtime synchronization.",
    payload: {
      type: "object",
      required: ["sessionId", "phase", "uxStateId", "revision", "updatedAt", "reason", "players", "tick", "resultsLifecycleState"],
      properties: {
        sessionId: NON_EMPTY_STRING,
        phase: FLOW_STATE_PHASE_SCHEMA,
        uxStateId: NON_EMPTY_STRING,
        revision: POSITIVE_INT,
        updatedAt: NON_NEGATIVE_INT,
        reason: NON_EMPTY_STRING,
        players: NON_NEGATIVE_INT,
        tick: NON_NEGATIVE_INT,
        resultsLifecycleState: RESULTS_LIFECYCLE_STATE_SCHEMA,
      },
    },
  },
  [WIS511_EVENT_TYPES.sessionLifecycleTransportConnectFailed]: {
    schemaId: "session.lifecycle.transport_connect_failed.v1",
    version: "v1",
    description: "Degraded-confidence entry event for transport/session availability.",
    payload: {
      type: "object",
      required: ["sessionId", "nowMs"],
      properties: {
        sessionId: NON_EMPTY_STRING,
        nowMs: NON_NEGATIVE_INT,
      },
    },
  },
  [WIS511_EVENT_TYPES.sessionSyncDesyncDetected]: {
    schemaId: "session.sync.desync_detected.v1",
    version: "v1",
    description: "Client/server authority divergence event for degraded-confidence monitoring.",
    payload: {
      type: "object",
      required: [
        "sessionId",
        "playerId",
        "action",
        "reason",
        "receivedRevision",
        "authoritativeRevision",
        "receivedTick",
        "authoritativeTick",
        "receivedStateHash",
        "authoritativeStateHash",
        "tickDelta",
        "maxAllowedTickDelta",
        "detectedAt",
      ],
      properties: {
        sessionId: NON_EMPTY_STRING,
        playerId: NULLABLE_STRING,
        action: {
          type: "string",
          enum: ["input", "disconnect", "reconnect", "advance", "complete"],
        },
        reason: {
          type: "string",
          enum: ["revision_mismatch", "state_hash_mismatch", "tick_mismatch"],
        },
        receivedRevision: POSITIVE_INT,
        authoritativeRevision: POSITIVE_INT,
        receivedTick: NON_NEGATIVE_INT,
        authoritativeTick: NON_NEGATIVE_INT,
        receivedStateHash: NON_EMPTY_STRING,
        authoritativeStateHash: NON_EMPTY_STRING,
        tickDelta: NON_NEGATIVE_INT,
        maxAllowedTickDelta: NON_NEGATIVE_INT,
        detectedAt: NON_NEGATIVE_INT,
      },
    },
  },
  [WIS511_EVENT_TYPES.sessionIntegrityViolation]: {
    schemaId: "session.integrity.violation.v1",
    version: "v1",
    description: "Authoritative integrity-rule violation stream for impossible input/movement/time drift.",
    payload: {
      type: "object",
      required: [
        "sessionId",
        "playerId",
        "ruleId",
        "category",
        "severity",
        "action",
        "tick",
        "revision",
        "detectedAt",
        "threshold",
        "windowCount",
        "evidence",
      ],
      properties: {
        sessionId: NON_EMPTY_STRING,
        playerId: NULLABLE_STRING,
        ruleId: NON_EMPTY_STRING,
        category: INTEGRITY_CATEGORY_SCHEMA,
        severity: INTEGRITY_SEVERITY_SCHEMA,
        action: INTEGRITY_ACTION_SCHEMA,
        tick: NON_NEGATIVE_INT,
        revision: POSITIVE_INT,
        detectedAt: NON_NEGATIVE_INT,
        threshold: {
          type: "union",
          anyOf: [{ type: "number", minimum: 0 }, NULL_SCHEMA],
        },
        windowCount: NON_NEGATIVE_INT,
        evidence: {
          type: "object",
          required: [],
          properties: {},
          additionalProperties: true,
        },
      },
    },
  },
  [WIS511_EVENT_TYPES.sessionIntegrityEscalated]: {
    schemaId: "session.integrity.escalated.v1",
    version: "v1",
    description: "Escalation signal when integrity violations cross configured thresholds.",
    payload: {
      type: "object",
      required: [
        "sessionId",
        "playerId",
        "fromSeverity",
        "toSeverity",
        "triggerRuleId",
        "windowStartMs",
        "windowEndMs",
        "violationCount",
        "escalatedAt",
      ],
      properties: {
        sessionId: NON_EMPTY_STRING,
        playerId: NULLABLE_STRING,
        fromSeverity: INTEGRITY_SEVERITY_SCHEMA,
        toSeverity: INTEGRITY_SEVERITY_SCHEMA,
        triggerRuleId: NON_EMPTY_STRING,
        windowStartMs: NON_NEGATIVE_INT,
        windowEndMs: NON_NEGATIVE_INT,
        violationCount: NON_NEGATIVE_INT,
        escalatedAt: NON_NEGATIVE_INT,
      },
    },
  },
  [WIS511_EVENT_TYPES.risingGroundEliminationTriggered]: {
    schemaId: "rg.elimination.triggered.v1",
    version: "v1",
    description: "Canonical elimination telemetry for authority -> analytics bridge.",
    payload: {
      type: "object",
      required: ["matchId", "playerId", "cause", "survivalMs", "rankAtElim", "aliveAtElim", "serverTs"],
      additionalProperties: false,
      properties: {
        matchId: NON_EMPTY_STRING,
        playerId: NON_EMPTY_STRING,
        cause: { type: "literal", value: "rising_ground" },
        survivalMs: NON_NEGATIVE_INT,
        rankAtElim: POSITIVE_INT,
        aliveAtElim: NON_NEGATIVE_INT,
        serverTs: NON_NEGATIVE_INT,
      },
    },
  },
});

export const WIS511_REQUIRED_ANALYTICS_EVENT_SET: readonly AnalyticsEventRequirement[] = Object.freeze([
  Object.freeze({
    id: "session_lifecycle_created",
    description: "Authoritative session creation must be observable.",
    eventTypes: [WIS511_EVENT_TYPES.sessionLifecycleCreated],
    minCount: 1,
  }),
  Object.freeze({
    id: "session_lifecycle_player_joined",
    description: "Authenticated player joins must be observable.",
    eventTypes: [WIS511_EVENT_TYPES.sessionLifecyclePlayerJoined],
    minCount: 1,
  }),
  Object.freeze({
    id: "input_acceptance",
    description: "Accepted authoritative inputs must be observable.",
    eventTypes: [WIS511_EVENT_TYPES.sessionInputAccepted],
    minCount: 1,
  }),
  Object.freeze({
    id: "rank_delta_or_leaderboard_snapshot",
    description: "Rank delta/snapshot updates must be observable for leaderboard integrity.",
    eventTypes: [WIS511_EVENT_TYPES.sessionLeaderboardUpdated],
    minCount: 1,
  }),
  Object.freeze({
    id: "elimination_signal",
    description: "Elimination telemetry must be present for analytics and replay parity.",
    eventTypes: [WIS511_EVENT_TYPES.risingGroundEliminationTriggered],
    minCount: 1,
  }),
  Object.freeze({
    id: "degraded_confidence_signal",
    description: "At least one degraded-confidence signal must be present.",
    eventTypes: [
      WIS511_EVENT_TYPES.sessionLifecycleTransportConnectFailed,
      WIS511_EVENT_TYPES.sessionSyncDesyncDetected,
    ],
    minCount: 1,
  }),
]);

export function validateSessionIdentityTokenClaimsV1(value: unknown): SchemaValidationResult {
  return validateWithSchema(SESSION_IDENTITY_TOKEN_SCHEMA, value);
}

export function isSessionIdentityTokenClaimsV1(value: unknown): value is SessionIdentityTokenClaimsV1 {
  return validateSessionIdentityTokenClaimsV1(value).valid;
}

export function parseSessionIdentityTokenClaimsV1(token: string): SessionIdentityTokenClaimsV1 | null {
  const [encodedPayload] = token.split(".", 2);
  if (!encodedPayload) {
    return null;
  }

  let decodedPayload: unknown;
  try {
    const json = Buffer.from(encodedPayload, "base64url").toString("utf8");
    decodedPayload = JSON.parse(json) as unknown;
  } catch {
    return null;
  }

  if (!isSessionIdentityTokenClaimsV1(decodedPayload)) {
    return null;
  }

  return decodedPayload;
}

export function validateEventPayload(eventType: string, payload: unknown): EventPayloadValidationResult {
  const schema = WIS511_EVENT_SCHEMAS[eventType];
  if (!schema) {
    return {
      eventType,
      schemaId: null,
      schemaVersion: null,
      valid: false,
      errors: [
        {
          path: "$",
          message: `No schema is registered for event type '${eventType}'`,
        },
      ],
    };
  }

  const result = validateWithSchema(schema.payload, payload);
  return {
    eventType,
    schemaId: schema.schemaId,
    schemaVersion: schema.version,
    valid: result.valid,
    errors: result.errors,
  };
}

export function validateRequiredAnalyticsEventSet(
  events: ReadonlyArray<Pick<TelemetryEvent, "type" | "payload">>,
): RequiredEventSetValidationResult {
  const missingRequirements: string[] = [];
  const invalidEvents: RequiredEventSetValidationResult["invalidEvents"] = [];

  for (const requirement of WIS511_REQUIRED_ANALYTICS_EVENT_SET) {
    const matchingIndices = events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => requirement.eventTypes.includes(event.type));

    if (matchingIndices.length < requirement.minCount) {
      missingRequirements.push(requirement.id);
      continue;
    }

    for (const { event, index } of matchingIndices) {
      const validation = validateEventPayload(event.type, event.payload);
      if (!validation.valid) {
        invalidEvents.push({
          requirementId: requirement.id,
          eventType: event.type,
          eventIndex: index,
          schemaId: validation.schemaId,
          errors: validation.errors,
        });
      }
    }
  }

  return {
    valid: missingRequirements.length === 0 && invalidEvents.length === 0,
    missingRequirements,
    invalidEvents,
  };
}

function validateWithSchema(schema: SchemaNode, value: unknown): SchemaValidationResult {
  const errors: SchemaValidationIssue[] = [];
  validateSchemaNode(schema, value, "$", errors);
  return {
    valid: errors.length === 0,
    errors,
  };
}

function validateSchemaNode(schema: SchemaNode, value: unknown, path: string, errors: SchemaValidationIssue[]): void {
  switch (schema.type) {
    case "string": {
      if (typeof value !== "string") {
        errors.push({ path, message: "Expected string" });
        return;
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push({ path, message: `Expected string length >= ${schema.minLength}` });
      }
      if (schema.enum && !schema.enum.includes(value)) {
        errors.push({ path, message: `Expected one of: ${schema.enum.join(", ")}` });
      }
      return;
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push({ path, message: "Expected finite number" });
        return;
      }
      if (schema.integer && !Number.isInteger(value)) {
        errors.push({ path, message: "Expected integer" });
      }
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push({ path, message: `Expected number >= ${schema.minimum}` });
      }
      return;
    }
    case "boolean": {
      if (typeof value !== "boolean") {
        errors.push({ path, message: "Expected boolean" });
      }
      return;
    }
    case "literal": {
      if (value !== schema.value) {
        errors.push({ path, message: `Expected literal ${JSON.stringify(schema.value)}` });
      }
      return;
    }
    case "null": {
      if (value !== null) {
        errors.push({ path, message: "Expected null" });
      }
      return;
    }
    case "array": {
      if (!Array.isArray(value)) {
        errors.push({ path, message: "Expected array" });
        return;
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        errors.push({ path, message: `Expected array length >= ${schema.minItems}` });
      }
      value.forEach((item, index) => {
        validateSchemaNode(schema.items, item, `${path}[${index}]`, errors);
      });
      return;
    }
    case "object": {
      if (!isPlainObject(value)) {
        errors.push({ path, message: "Expected object" });
        return;
      }

      for (const key of schema.required) {
        if (!(key in value)) {
          errors.push({ path: `${path}.${key}`, message: "Missing required field" });
        }
      }

      for (const [key, keySchema] of Object.entries(schema.properties)) {
        if (key in value) {
          validateSchemaNode(keySchema, (value as Record<string, unknown>)[key], `${path}.${key}`, errors);
        }
      }

      if (schema.additionalProperties === false) {
        for (const key of Object.keys(value)) {
          if (!(key in schema.properties)) {
            errors.push({ path: `${path}.${key}`, message: "Unexpected field" });
          }
        }
      }
      return;
    }
    case "union": {
      const branchErrors: SchemaValidationIssue[][] = [];

      for (const branch of schema.anyOf) {
        const trialErrors: SchemaValidationIssue[] = [];
        validateSchemaNode(branch, value, path, trialErrors);
        if (trialErrors.length === 0) {
          return;
        }
        branchErrors.push(trialErrors);
      }

      const bestBranch = branchErrors.sort((left, right) => left.length - right.length)[0];
      if (bestBranch) {
        for (const error of bestBranch) {
          errors.push(error);
        }
      } else {
        errors.push({ path, message: "Value did not match any allowed schema" });
      }
      return;
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
