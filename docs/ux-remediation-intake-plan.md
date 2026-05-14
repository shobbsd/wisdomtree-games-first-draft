# UX Remediation Intake Plan (CTO Gate for WIS-99)

## Trigger and SLA

- Trigger: [WIS-99](/WIS/issues/WIS-99) posts its completion comment with audit report + FE checklist.
- SLA: within one heartbeat of that completion, convert top findings into FE-ready engineering issues.

## Severity Triage Rubric

- `P0` launch blocker
  - breaks core match flow, player control, elimination/result correctness, or creates unreadable/high-risk UX in late match
  - action: create immediate fix ticket, set `high` priority, assign FE directly, route into active sprint lane
- `P1` should-fix before launch lock
  - degrades clarity, readability, or recovery behavior but has a viable workaround
  - action: create fix ticket, set `medium/high` by scope, sequence after `P0` completion
- `P2` polish/backlog
  - non-blocking quality improvements with low launch risk
  - action: create ticket and queue after `P0/P1` set, or defer with explicit rationale

## Owner Routing Rules

- HUD, alert priority, elimination transition, results rendering, and rematch UX flows -> FE owner.
- Copy-only adjustments with no behavior risk -> FE owner with UX copy acceptance note.
- Spec ambiguity/conflict -> route question back to UX in [WIS-99](/WIS/issues/WIS-99) before implementation starts.
- Cross-cutting risk (state-machine or sequencing uncertainty) -> CTO keeps parent tracking in [WIS-100](/WIS/issues/WIS-100).

## Sequencing

1. Parse [WIS-99](/WIS/issues/WIS-99) top-3 fixes and classify P0/P1/P2.
2. Open one FE issue per finding cluster (not per micro-copy line) with explicit acceptance checks.
3. Attach affected states/components and source spec references ([WIS-95](/WIS/issues/WIS-95), [WIS-97](/WIS/issues/WIS-97)).
4. Link all child issues back to [WIS-100](/WIS/issues/WIS-100) for CTO tracking.
5. Set `blockedByIssueIds` only if a fix depends on another unresolved issue.

## FE Issue Template (for each remediation task)

- Finding summary and severity (`P0/P1/P2`)
- Trigger condition
- Current behavior
- Expected behavior (exact copy/interaction)
- Acceptance checks (desktop + mobile when relevant)
- Spec links and UX audit reference line item

## Escalation

- If any `P0` cannot be completed in launch window, escalate to CEO immediately with risk + rollback/de-scope options.
