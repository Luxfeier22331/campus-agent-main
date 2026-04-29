# Phase 5: Supervisor Entry, ACL, And Audit - Research

**Researched:** 2026-03-27
**Confidence:** HIGH
**Execution Status:** Applied and verified on 2026-03-27

## Executive Summary

Phase 5 did not need a new architecture decision. The core boundaries were already frozen by Phase 1 and the 04.x handoff docs.

The actual remaining work was operational:

1. stop trusting client-supplied bearer actor headers
2. project real caller identity through the trusted-worker path
3. persist supervisor audit records instead of keeping them test-only

## Findings

### What was already true

- `apps/supervisor-api` already constructed `SupervisorRequest` and called `packages/supervisor-core`
- `packages/supervisor-core` already framed `SpecialistRequest` and preserved actor/trace/request identity through the handoff
- retrieval ACL filtering was already specialist/retrieval-owned and consumed `ActorContext`
- supervisor-core already defined a minimal audit projection shape

### What was missing

- `bearer` mode still trusted naked `x-actor-*` headers from the client
- `trusted-worker` mode authenticated origin trust but did not yet project final caller identity from Access JWT claims
- `AUDIT_LOG_PATH` was configured but unused; no persistent audit trail existed for handled requests

## Chosen Direction

### 05-01: Runtime request entry stays supervisor-facing and fail-closed

- keep `SupervisorRequest` as the only public query contract
- keep API shell free of routing/policy logic
- make `bearer` runtime-owned instead of header-trusting

### 05-02: Actor and group propagation reaches the specialist / retrieval seam

- preserve typed `ActorContext` through supervisor framing
- use `trusted-worker + cf-access-jwt-assertion` to project caller identity claims
- verify the specialist handoff sees the propagated actor fields

### 05-03: Audit projection becomes durable runtime behavior

- keep supervisor-core as the owner of audit record shape
- persist JSONL audit lines from the API shell
- record both success and supervisor error outcomes

## Verification Strategy

- supervisor-core tests must still prove minimal audit projection shape
- api tests must prove:
  - bearer ignores spoofed actor headers
  - trusted-worker projects actor identity from JWT claims
  - specialist handoff receives typed actor/groups
  - success and supervisor error both write audit log lines
- final regression must include supervisor and api suites together

## Non-Goals

- release-gate eval/smoke expansion
- retrieval-core strategy changes
- panel auth/governance
- app/chat-layer identity systems

---

*Phase 5 research completed and applied: 2026-03-27*
