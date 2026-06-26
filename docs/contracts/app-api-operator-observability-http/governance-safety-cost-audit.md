---
doc_type: contract
truth_scope: ops
owner_boundary: apps/app-api
status: active
created: 2026-06-13
updated: 2026-06-13
---

# App API Operator Observability Governance Safety Cost Audit HTTP

<!-- markdownlint-disable MD013 -->

Split from the former mega-doc during documentation SoT cleanup. This file
owns this section group; the original path remains the stable index.

## Intent Governance Endpoints

### `GET /api/operator/intent/summary`

返回入口意图治理摘要，用于发现 classifier、schema 与 context resolution drift。

响应：

```json
{
  "window": {
    "from": "2026-04-02T00:00:00.000Z",
    "to": "2026-04-03T00:00:00.000Z",
    "granularity": "15m"
  },
  "runtime": {
    "requestCount": 248,
    "lowConfidenceRate": {
      "value": 0.0403,
      "count": 10,
      "eligibleCount": 248
    },
    "ambiguityRate": {
      "value": 0.0605,
      "count": 15,
      "eligibleCount": 248
    },
    "contextUnresolvedRate": {
      "value": 0.0121,
      "count": 3,
      "eligibleCount": 248
    },
    "distributions": {
      "capability": [{ "value": "knowledge", "count": 180 }],
      "taskKind": [{ "value": "knowledge_lookup", "count": 170 }],
      "launchState": [{ "value": "open", "count": 210 }],
      "nextAction": [{ "value": "delegate", "count": 205 }],
      "scopeClass": [{ "value": "in_scope", "count": 232 }],
      "classifierVersion": [
        { "value": "intent-classifier@2026-04-20", "count": 248 }
      ],
      "schemaVersion": [{ "value": "intent-schema-1.0.0", "count": 248 }]
    }
  },
  "sampledGrades": {
    "coverageRate": {
      "value": 0.121,
      "count": 30,
      "eligibleCount": 248
    },
    "intentPassRate": {
      "value": 0.9,
      "count": 27,
      "eligibleCount": 30
    }
  },
  "asOf": "2026-04-03T00:00:10.000Z"
}
```

规则：

- `runtime.*` 来自 `runtime.request_observability_fact` 中的 typed intent summary
- `sampledGrades.*` 来自 `operator.quality_grade_projection` 的 `gradeDomain=intent`
- distributions 只返回 operator-safe code / version / count，不返回 raw prompt、raw user
  transcript 或 raw classifier payload

### `GET /api/operator/intent/timeseries`

返回 intent governance trend。

响应：

```json
{
  "window": {
    "from": "2026-04-02T00:00:00.000Z",
    "to": "2026-04-03T00:00:00.000Z",
    "granularity": "15m"
  },
  "series": [
    {
      "bucketStart": "2026-04-02T00:00:00.000Z",
      "bucketEnd": "2026-04-02T00:15:00.000Z",
      "requestCount": 42,
      "lowConfidenceRate": 0.0476,
      "ambiguityRate": 0.0714,
      "contextUnresolvedRate": 0.0238,
      "sampledIntentPassRate": 0.875
    }
  ],
  "asOf": "2026-04-03T00:00:10.000Z"
}
```

## Safety/Authz Endpoints

### `GET /api/operator/safety/summary`

响应：

```json
{
  "window": {
    "from": "2026-04-02T00:00:00.000Z",
    "to": "2026-04-03T00:00:00.000Z",
    "granularity": "15m"
  },
  "summary": {
    "decisionDistribution": {
      "allowed": 1178,
      "approvalRequired": 22,
      "denied": 37,
      "failClosed": 11
    },
    "aclAnomalyRate": {
      "value": 0.0016,
      "count": 2,
      "eligibleCount": 1248
    },
    "restrictedDenyRate": {
      "value": 0.0296,
      "count": 37,
      "eligibleCount": 1248
    },
    "failClosedRate": {
      "value": 0.0088,
      "count": 11,
      "eligibleCount": 1248
    }
  },
  "asOf": "2026-04-03T00:00:10.000Z"
}
```

规则：

- `decisionDistribution` 基于 app-owned authz projection / request observability
  fact
- `aclAnomalyRate` 只计入显式 anomaly code，不用 query path 推测

### `GET /api/operator/safety/anomalies`

查询参数：

- `limit`
- `cursor`
- `severity`
- `status`
- `anomalyCode`

响应：

```json
{
  "anomalies": [
    {
      "anomalyId": "aclanom_01HQ",
      "requestId": "req_01HQ",
      "traceId": "trace_01HQ",
      "surface": "operator_console_web",
      "principalType": "operator",
      "selectedCapability": "knowledge",
      "anomalyCode": "projection_missing",
      "severity": "high",
      "status": "open",
      "summary": "request finalized 但缺少 policy projection version",
      "detectedAt": "2026-04-03T00:12:00.000Z",
      "links": {
        "traceLink": "https://sentry.example/organizations/campus/traces/trace_01HQ",
        "issueLink": "https://sentry.example/organizations/campus/issues/123",
        "issueFingerprint": "projection-missing"
      }
    }
  ],
  "page": {
    "nextCursor": null
  }
}
```

规则：

- anomaly queue 是 curated operator queue，不等于 raw audit 或 raw sink exception list
- 不直接返回 restricted document identifier 的敏感原文；必要时只返回安全摘要或受控 doc id

## Cost Endpoints

### `GET /api/operator/cost/summary`

响应：

```json
{
  "window": {
    "from": "2026-04-02T00:00:00.000Z",
    "to": "2026-04-03T00:00:00.000Z",
    "granularity": "15m"
  },
  "summary": {
    "tokens": {
      "input": 1320440,
      "output": 481220,
      "cachedInput": 92100
    },
    "estimatedCost": {
      "microusd": 4823100,
      "currency": "USD"
    },
    "byModel": [
      {
        "modelName": "gpt-5.2-mini",
        "requestCount": 1180,
        "estimatedCostMicrousd": 4011200
      }
    ],
    "bySurface": [
      {
        "surface": "campus_web",
        "requestCount": 1098,
        "estimatedCostMicrousd": 4325000
      }
    ]
  },
  "asOf": "2026-04-03T00:00:10.000Z"
}
```

规则：

- 第一版返回 near-real-time estimated cost
- provider reconciled cost 可以后续作为独立 aggregate block 加入，但不得覆盖 request-scoped
  runtime estimated cost

### `GET /api/operator/cost/timeseries`

响应：

```json
{
  "window": {
    "from": "2026-04-02T00:00:00.000Z",
    "to": "2026-04-03T00:00:00.000Z",
    "granularity": "1h"
  },
  "series": [
    {
      "bucketStart": "2026-04-02T00:00:00.000Z",
      "bucketEnd": "2026-04-02T01:00:00.000Z",
      "inputTokens": 52210,
      "outputTokens": 18300,
      "cachedInputTokens": 4100,
      "estimatedCostMicrousd": 181200
    }
  ],
  "asOf": "2026-04-03T00:00:10.000Z"
}
```

规则：

- cost timeseries 使用 app-owned rollup，不从 `Axiom` 或 provider billing API 现查

## Audit Endpoints

### `GET /api/operator/audit`

查询参数：

- `limit`
- `cursor`
- `requestId`
- `traceId`
- `principalType`
- `surface`
- `selectedCapability`
- `eventType`
- `status`

响应：

```json
{
  "events": [
    {
      "auditEventId": "aevt_01HQ",
      "requestId": "req_01HQ",
      "traceId": "trace_01HQ",
      "occurredAt": "2026-04-03T00:00:00.500Z",
      "eventType": "authz.decision",
      "surface": "campus_web",
      "principalType": "campus_member",
      "selectedCapability": "knowledge",
      "status": "allowed",
      "summary": "student_rules 请求通过 authz check"
    }
  ],
  "page": {
    "nextCursor": null
  }
}
```

规则：

- 返回 curated audit timeline summary，不是 raw JSONL replay
- `summary` 必须是 governance-safe 文本，不回显 raw auth material 或 raw answer
- 当前已冻结的第一版 contract 事件类型先以 request lifecycle 为主，例如 `request.accepted`、`request.
  completed`、`request.no_answer`、`request.needs_clarification`、`request.error`、`
  request.approval_required`、`request.rejected`、`request.cancelled`
- execution runtime kernel event 可以通过 `app-api` internal ingest 进入同一 audit
  projection；第一版只允许 `execution.admission_rejected`、`execution.cancel_requested`、
  `execution.cancelled`、`execution.runtime_failed`、`execution.timed_out`
- 更细粒度的 `authz.decision`、`retrieval.summary`、`operator.action` 后续可以在不破坏 owner
  模型的前提下追加，但不能回退成 raw log query

### `GET /api/operator/audit/:auditEventId`

响应：

```json
{
  "event": {
    "auditEventId": "aevt_01HQ",
    "requestId": "req_01HQ",
    "traceId": "trace_01HQ",
    "occurredAt": "2026-04-03T00:00:00.500Z",
    "eventType": "authz.decision",
    "surface": "campus_web",
    "principalType": "campus_member",
    "entitlementSnapshotId": "ent_01HQ",
    "policyProjectionVersion": "2026-04-02",
    "requestedCapability": "knowledge",
    "selectedCapability": "knowledge",
    "status": "allowed",
    "terminalCode": "completed",
    "summary": "student_rules 请求通过 authz check",
    "diagnostics": {
      "failClosed": false,
      "aclAnomalyCode": null,
      "sourceDocIds": ["handbook:library-hours"]
    }
  },
  "links": {
    "traceLink": "https://sentry.example/organizations/campus/traces/trace_01HQ",
    "issueLink": null,
    "issueFingerprint": null
  }
}
```

规则：

- detail 允许比 list 多出
  `entitlementSnapshotId`、`policyProjectionVersion`、`diagnostics`
- 仍不返回 raw JWT、raw cookies、raw prompt、raw answer、raw retrieval payload
- `links` 允许全部为 `null`；配置了 app-owned backlink recorder 或 external internal
  producer 后才返回 safe deep link / fingerprint
- `links.*` 必须继续经过 app-owned projection，不允许 detail route 直接查询 sink
