---
doc_type: contract
status: active
created: 2026-04-03
updated: 2026-04-13
---

# App API Operator Observability HTTP Contract

## 文档边界

这份文档冻结 `apps/app-api` 暴露给 `protected-panel-web` 的 operator observability query contract。

它补充但不替代以下文档：

- browser-facing app contract：`docs/contracts/app-api-http.md`
- request lifecycle 与 request projection：`docs/contracts/app-api-request-lifecycle.md`
- product/control-plane ownership：`docs/architecture/product-runtime-architecture.md`
- operator observability supporting architecture：`docs/architecture/operator-observability-architecture.md`
- 领域导航：`docs/domains/operator-observability.md`
- ownership / sink participation 决策：`docs/decisions/adr-0023-operator-observability-control-plane-and-sink-participation.md`
- 当前 merged-truth schema：`docs/data/app-api-schema.md`

这份文档不冻结：

- panel UI layout、卡片排列或交互细节
- telemetry sink vendor SDK 的逐字段接入方式
- 告警阈值、sampling ratio、retention 天数
- operator 写操作、acknowledge / resolve / override API
- raw log、raw trace、raw audit JSONL、raw grader payload 的直接查询能力

## 适用范围

长期 operator observability query path 固定为：

`operator browser -> protected-panel-web same-site /api/* -> app-api`

这里冻结的都是只读 query endpoints。

它们共享以下前提：

- operator principal admission 继续复用 shared `app-api` operator access model
- panel 继续只消费 runtime-owned projections / rollups
- `Sentry`、`Axiom`、sampled grading / eval tooling 继续只是 sink 或输入来源，不直接充当 query backend
- grader / sink 如果要让 panel 消费结果，必须先通过 `app-api` owned internal ingest seam 写入 projection

## Contract 与实现范围说明

这份文档冻结的是 forward contract，不表示 `develop` 已经完整实现文中所有 endpoint。

判断当前已实现子集时：

- 当前已落地能力以 `docs/architecture/current-architecture.md` 和代码为准
- 当前 accepted direction 与长期边界以本文、supporting architecture 与相关 ADR 为准

## Cross-Cutting Rules

- JSON body 使用 `camelCase`
- 时间戳使用 ISO 8601 UTC 字符串
- enum / code value 使用小写语义值，例如 `completed`、`citation_missing`、`projection_lag_spike`
- 所有错误响应继续使用 `docs/contracts/app-api-error-model.md` 中定义的统一 envelope
- `requestId` 是业务级 correlation id；`traceId` 是 runtime trace correlation id
- panel-facing sink backlink 只允许返回安全的 deep link / fingerprint，不返回 raw sink event blob
- token / model / retrieval / citation / ACL facts 必须来自 execution-side typed telemetry seam 或 app-owned runtime fact family，不得由 panel query path 反推
- 所有 summary / timeseries / queue 都必须由 `app-api` owned projection、rollup 或 grade projection 提供；panel 不得直接查询 sink

### Common Query Parameters

所有聚合与队列类 endpoints 默认支持以下公共参数：

- `window`
  - 允许值：`15m`、`1h`、`24h`、`7d`、`30d`
  - 默认：`24h`
- `surface`
- `selectedTarget`
- `requestedCapability`
- `principalType`
- `collection`
- `modelName`

timeseries endpoints 额外支持：

- `granularity`
  - 允许值：`5m`、`15m`、`1h`、`1d`

list endpoints 额外支持：

- `limit`
- `cursor`

规则：

- `window` 与 `granularity` 的非法组合返回 `400 validation_failed`
- 未传 filter 时表示查询当前 operator 可见范围内的全量 app-owned aggregate
- 过滤只作用于 app-owned projection / rollup 维度，不隐式回源 raw sink

## Endpoint Summary

### Overview

- `GET /api/operator/overview`

### Requests

- `GET /api/operator/requests`
  - summary / detail shape 继续由 `docs/contracts/app-api-http.md` 冻结
- `GET /api/operator/requests/:requestId`
  - summary / detail shape 继续由 `docs/contracts/app-api-http.md` 冻结
- `GET /api/operator/requests/:requestId/observability`

### Quality

- `GET /api/operator/quality/summary`
- `GET /api/operator/quality/timeseries`
- `GET /api/operator/quality/badcases`

### Safety/Authz

- `GET /api/operator/safety/summary`
- `GET /api/operator/safety/anomalies`

### Cost

- `GET /api/operator/cost/summary`
- `GET /api/operator/cost/timeseries`

### Audit

- `GET /api/operator/audit`
- `GET /api/operator/audit/:auditEventId`

第一版不冻结：

- operator acknowledge / resolve / retry / export API
- ad-hoc SQL / log / trace explorer
- sink query passthrough API
- custom dashboard composition API

## Response Shapes

### Window

```json
{
  "from": "2026-04-03T00:00:00.000Z",
  "to": "2026-04-03T23:59:59.999Z",
  "granularity": "15m"
}
```

### Trace Backlinks

```json
{
  "traceLink": "https://sentry.example/organizations/campus/traces/trace_01HQ",
  "issueLink": "https://sentry.example/organizations/campus/issues/123",
  "issueFingerprint": "timeout:supervisor-api"
}
```

规则：

- `traceLink`、`issueLink`、`issueFingerprint` 都是 panel-friendly backlink
- 没有关联对象时允许返回 `null`
- 不返回 sink 原始 payload 或 query 语句
- 当前 forward contract 接受这些字段最终由 `operator.trace_backlink_projection` 提供

### Metric Ratio

```json
{
  "value": 0.041,
  "count": 12,
  "eligibleCount": 290
}
```

规则：

- `count` 是命中数
- `eligibleCount` 是该指标合法分母；不适用时允许为 `null`

## Overview Endpoint

### `GET /api/operator/overview`

返回 operator overview 所需的最小控制面快照。

响应：

```json
{
  "window": {
    "from": "2026-04-02T00:00:00.000Z",
    "to": "2026-04-03T00:00:00.000Z",
    "granularity": "15m"
  },
  "overview": {
    "requestVolume": {
      "accepted": 1248,
      "completed": 1219,
      "errored": 17
    },
    "latency": {
      "p50Ms": 820,
      "p95Ms": 2440,
      "p99Ms": 6890
    },
    "failureRate": {
      "value": 0.0136,
      "count": 17,
      "eligibleCount": 1248
    },
    "emptyRecallRate": {
      "value": 0.0831,
      "count": 27,
      "eligibleCount": 325
    },
    "citationMissRate": {
      "value": 0.0413,
      "count": 12,
      "eligibleCount": 290
    },
    "refusalRate": {
      "value": 0.1114,
      "count": 139,
      "eligibleCount": 1248
    },
    "aclAnomalyRate": {
      "value": 0.0016,
      "count": 2,
      "eligibleCount": 1248
    },
    "estimatedCost": {
      "microusd": 4823100,
      "currency": "USD"
    },
    "sinkHealth": {
      "missingTraceRate": {
        "value": 0.0072,
        "count": 9,
        "eligibleCount": 1248
      },
      "projectionFailureCount": 1
    }
  },
  "alerts": [
    {
      "alertId": "opalert_01HQ",
      "domain": "safety",
      "severity": "high",
      "code": "safety.remote_content_suspicion_spike",
      "status": "open",
      "startedAt": "2026-04-02T12:00:00.000Z",
      "requestCount": 3,
      "incidentBackfill": {
        "required": true,
        "mode": "incident_backfill"
      }
    }
  ],
  "asOf": "2026-04-03T00:00:10.000Z"
}
```

`alerts[]` 当前固定支持的最小 `safety` codes：

- `safety.rate_limit_exceeded`
- `safety.remote_content_suspicion_spike`
- `safety.provider_content_filter_spike`

规则：

- `requestCount` 表示同一 `safety_identifier` 在告警窗口内的命中请求数
- `incidentBackfill.required=true` 表示 operator closeout 不能停在 dashboard annotation，必须回灌 golden governance 的 `incident_backfill`
- `incidentBackfill.mode=null` 表示这是纯产品侧 abuse control 告警，不自动要求 eval backfill

规则：

- 这是 app-owned overview snapshot，不是 sink dashboard embed
- `alerts` 是 operator-facing curated summary，不要求与任一 vendor 告警系统一一对应
- `emptyRecallRate` 只对 `retrievalAttempted=true` 的请求计数
- `citationMissRate` 只对 `citationExpected=true` 的请求计数

## Requests Observability Endpoint

### `GET /api/operator/requests/:requestId/observability`

返回 request detail 页的 observability / quality / safety 摘要。

响应：

```json
{
  "request": {
    "requestId": "req_01HQ",
    "traceId": "trace_01HQ",
    "conversationId": "conv_01HQ",
    "surface": "public_chat_web",
    "status": "completed",
    "requestedCapability": "knowledge",
    "requestedScope": null,
    "resolvedScope": {
      "corpus": "curriculum",
      "collection": "curriculum_plan"
    },
    "selectedTarget": "rag-specialist",
    "startedAt": "2026-04-03T00:00:00.000Z",
    "completedAt": "2026-04-03T00:00:00.842Z"
  },
  "observability": {
    "durationMs": 842,
    "retrievalAttempted": true,
    "candidateCount": 18,
    "retrievedSourceCount": 4,
    "emptyRecall": false,
    "citationExpected": true,
    "citationCount": 2,
    "citationMissing": false,
    "refusalClass": null,
    "aclDecision": "allowed",
    "aclAnomalyCode": null,
    "failClosed": false,
    "retrievalAdequacyVerdict": "sufficient",
    "retrievalAdequacyReason": "sufficient",
    "claimSupportSummary": {
      "totalClaims": 3,
      "supportedClaims": 1,
      "unsupportedClaims": 2,
      "unsupportedClaimTypes": [
        "audience_or_major_or_program_or_class_family",
        "offering_unit_or_owning_school"
      ],
      "unsupportedFields": [
        "audience_claims",
        "offering_unit_claims"
      ]
    },
    "model": {
      "provider": "openai",
      "name": "gpt-5.2-mini"
    },
    "prompt": {
      "id": "rag_answer_v1",
      "version": "v1",
      "templateSha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "runtimeState": null,
      "runtimeDetail": null
    },
    "inputTokens": 812,
    "outputTokens": 229,
    "cachedInputTokens": 0,
    "estimatedCost": {
      "microusd": 3810,
      "currency": "USD"
    },
    "sourceTrace": {
      "retrieved": [
        {
          "docId": "curriculum:法学（民族实验班）本科人才培养方案",
          "chunkId": "chunk-raw-1",
          "score": 0.94,
          "collection": "curriculum_plan",
          "sourceTitle": "法学（民族实验班）本科人才培养方案",
          "canonicalSourceId": null,
          "canonicalSourceTitle": null,
          "sourceUnitKind": null,
          "sourceUnitKey": null
        }
      ],
      "supporting": [
        {
          "docId": "program_semester_facts:law:semester-4",
          "chunkId": "chunk-support-1",
          "score": 0.97,
          "collection": "program_semester_facts",
          "sourceTitle": "法学（民族实验班）本科人才培养方案 第四学期课程事实",
          "canonicalSourceId": "curriculum:法学（民族实验班）本科人才培养方案",
          "canonicalSourceTitle": null,
          "sourceUnitKind": "semester_course_list",
          "sourceUnitKey": "semester-4"
        }
      ]
    },
    "traceAvailable": true,
    "projectionLagMs": 420,
    "measuredAt": "2026-04-03T00:00:01.300Z"
  },
  "links": {
    "traceLink": "https://sentry.example/organizations/campus/traces/trace_01HQ",
    "issueLink": null,
    "issueFingerprint": null
  },
  "auditSummary": {
    "auditEventCount": 5,
    "latestTerminalCode": "completed"
  }
}
```

规则：

- 这是 request-scoped observability summary，不是 raw execution dump
- 不返回 raw prompt、raw answer、raw transcript、raw auth material、raw retrieval payload
- `requestedScope` 反映 accept 时上游是否显式约束 scope，可为 `null`
- `resolvedScope` 反映 execution side 最终命中的 serving surface，是 panel 侧 quality / collection 归因的真相源
- `retrievalAttempted`、`citationExpected`、`aclDecision` 必须来自 typed execution seam 或 app-owned runtime fact family
- `sourceTrace.retrieved` 表示 bounded raw retrieval candidate trace；`sourceTrace.supporting` 表示最终 answer-facing support set
- `sourceTrace.*` 只允许返回 operator-safe compact identity fields，例如 `docId`、`chunkId`、`score`、`collection`、canonical / source-unit identity；不得返回 raw snippet dump
- `sourceTrace.supporting[*].canonicalSourceId` 与 `sourceTrace.supporting[*].sourceUnitKey` 用于显式区分 canonical curriculum identity 与物理 projection-unit hit
- `retrievalAdequacyVerdict` / `retrievalAdequacyReason` 用于区分 retrieval base 不足与 post-generation grounding downgrade
- `claimSupportSummary` 只返回 compact 的 claim-level 聚合：总 claim 数、unsupported claim type、unsupported field；不返回 raw `claim_supports`、support snippet 或 provider-native citation/support blob
- `observability.prompt.*` 只暴露 prompt identity 与 typed runtime branch，不返回 raw prompt
- token / model 字段必须来自 execution-side typed telemetry seam，不从 sink query 反推
- `links.*` 必须来自 app-owned backlink projection，而不是 route-time sink query

## Quality Endpoints

### `GET /api/operator/quality/summary`

响应：

```json
{
  "window": {
    "from": "2026-04-02T00:00:00.000Z",
    "to": "2026-04-03T00:00:00.000Z",
    "granularity": "15m"
  },
  "runtime": {
    "requestCount": 1248,
    "emptyRecallRate": {
      "value": 0.0831,
      "count": 27,
      "eligibleCount": 325
    },
    "citationMissRate": {
      "value": 0.0413,
      "count": 12,
      "eligibleCount": 290
    },
    "refusalDistribution": {
      "noAnswer": 61,
      "needsClarification": 48,
      "approvalRequired": 9,
      "rejected": 21
    }
  },
  "sampledGrades": {
    "coverageRate": {
      "value": 0.0368,
      "count": 46,
      "eligibleCount": 1248
    },
    "groundingPassRate": {
      "value": 0.913,
      "count": 42,
      "eligibleCount": 46
    },
    "citationPassRate": {
      "value": 0.869,
      "count": 40,
      "eligibleCount": 46
    },
    "policyPassRate": {
      "value": 0.978,
      "count": 45,
      "eligibleCount": 46
    },
    "badcaseOpenCount": 7
  },
  "asOf": "2026-04-03T00:00:10.000Z"
}
```

规则：

- `runtime` 与 `sampledGrades` 必须分块返回，不混成单一 truth
- sampled grading 缺失时，`sampledGrades` 允许为空块或 `null` 值，不得用 runtime 指标冒充 grader 结果
- 当前已冻结的第一版 contract 返回 `sampledGrades: null`
- forward contract 上，`sampledGrades` 的上游固定为 `operator.quality_grade_projection`

### `GET /api/operator/quality/timeseries`

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
      "requestCount": 52,
      "emptyRecallRate": 0.096,
      "citationMissRate": 0.044,
      "noAnswerRate": 0.058,
      "needsClarificationRate": 0.019,
      "sampledGroundingPassRate": 0.9
    }
  ],
  "asOf": "2026-04-03T00:00:10.000Z"
}
```

规则：

- timeseries bucket 只返回 app-owned aggregate，不内嵌 raw request rows
- sampled grade 相关曲线允许出现 `null`，表示该 bucket 没有足够样本
- 当前已冻结的第一版 contract 由 `operator.metric_rollup` 重建 `requestCount`、`emptyRecallRate`、`citationMissRate`、`noAnswerRate`、`needsClarificationRate`
- 当前已冻结的第一版 contract 中，`sampledGroundingPassRate` 固定为 `null`
- forward contract 上，`sampledGroundingPassRate` 的上游固定为 `operator.quality_grade_projection` 与 request bucket join

### `GET /api/operator/quality/badcases`

查询参数：

- `limit`
- `cursor`
- `status`
- `causeClass`
- `detectedBy`

响应：

```json
{
  "badcases": [
    {
      "badcaseId": "qbad_01HQ",
      "requestId": "req_01HQ",
      "traceId": "trace_01HQ",
      "surface": "public_chat_web",
      "selectedTarget": "rag-specialist",
      "status": "open",
      "causeClass": "citation_missing",
      "detectedBy": "runtime_monitor",
      "openedAt": "2026-04-03T00:10:00.000Z",
      "summary": "citationExpected=true 但 citationCount=0",
      "grade": {
        "result": "fail",
        "score": 0.42,
        "graderVersion": "grader@2026-04-02"
      },
      "links": {
        "traceLink": "https://sentry.example/organizations/campus/traces/trace_01HQ",
        "issueLink": null,
        "issueFingerprint": null
      }
    }
  ],
  "page": {
    "nextCursor": null
  }
}
```

规则：

- 这是 app-owned badcase queue，不是 grader 原始输出列表
- `summary` 必须是安全摘要，不暴露 raw prompt / answer
- 当前已冻结的第一版 contract 只支持 `status` / `causeClass` / `detectedBy` 过滤，不按 sink backlink 或 grader 结果过滤
- 当前已冻结的第一版 contract 中，`detectedBy` 固定来自 `runtime_monitor`
- 当前已冻结的第一版 contract 中，`causeClass` 仅已落地 `citation_missing`、`empty_recall`
- 当前已冻结的第一版 contract 中，`grade` 与 `links` 允许全部为 `null`
- forward contract 上，`grade` 的上游固定为 `operator.quality_grade_projection`，`links.*` 的上游固定为 `operator.trace_backlink_projection`

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

- `decisionDistribution` 基于 app-owned authz projection / request observability fact
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
      "surface": "protected_panel_web",
      "principalType": "operator",
      "selectedTarget": "rag-specialist",
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
        "surface": "public_chat_web",
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
- provider reconciled cost 可以后续作为独立 aggregate block 加入，但不得覆盖 request-scoped runtime estimated cost

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
- `selectedTarget`
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
      "surface": "public_chat_web",
      "principalType": "campus_member",
      "selectedTarget": "rag-specialist",
      "status": "allowed",
      "summary": "student_handbook 请求通过 authz check"
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
- 当前已冻结的第一版 contract 事件类型先以 request lifecycle 为主，例如 `request.accepted`、`request.completed`、`request.no_answer`、`request.needs_clarification`、`request.error`、`request.approval_required`、`request.rejected`
- 更细粒度的 `authz.decision`、`retrieval.summary`、`operator.action` 后续可以在不破坏 owner 模型的前提下追加，但不能回退成 raw log query

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
    "surface": "public_chat_web",
    "principalType": "campus_member",
    "entitlementSnapshotId": "ent_01HQ",
    "policyProjectionVersion": "2026-04-02",
    "requestedCapability": "knowledge",
    "selectedTarget": "rag-specialist",
    "status": "allowed",
    "terminalCode": "completed",
    "summary": "student_handbook 请求通过 authz check",
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

- detail 允许比 list 多出 `entitlementSnapshotId`、`policyProjectionVersion`、`diagnostics`
- 仍不返回 raw JWT、raw cookies、raw prompt、raw answer、raw retrieval payload
- 第一版 `links` 允许全部为 `null`；后续再把 `Sentry`/sink backlink 稳定接入 detail 面
- `links.*` 稳定接入后也必须继续经过 app-owned projection，不允许 detail route 直接查询 sink

## Internal Ingest Endpoints

以下 endpoint 是 app-owned internal command seam，不是 browser-facing panel API：

- `POST /api/internal/operator/quality/grades`
- `POST /api/internal/operator/trace-backlinks`

适用前提：

- 调用方必须携带 `x-app-internal-auth`
- 这是 internal producer（grader worker / sink reconciliation worker）写入 projection 的入口
- 这些 endpoint 不向 panel 暴露，不支持 ad-hoc query

### `POST /api/internal/operator/quality/grades`

请求体：

```json
{
  "grades": [
    {
      "requestId": "req_01HQ",
      "traceId": "trace_01HQ",
      "gradeSource": "openai_trace_grader",
      "gradeDomain": "grounding",
      "verdict": "pass",
      "score": 0.913,
      "graderVersion": "grader@2026-04-03",
      "sampledAt": "2026-04-03T00:10:00.000Z",
      "rationaleSummary": "grounded to cited handbook passages"
    }
  ]
}
```

规则：

- `requestId` 必须已存在于 app-owned request truth
- 调用时允许只传最小 grading payload；route/service 可以通过 app-owned request fact family 回填 `surface`、`collection`、`modelName` 等维度
- 不接受 raw grader transcript、raw prompt、raw answer、raw span payload

### `POST /api/internal/operator/trace-backlinks`

请求体：

```json
{
  "backlinks": [
    {
      "requestId": "req_01HQ",
      "traceId": "trace_01HQ",
      "traceLink": "https://sentry.example/organizations/campus/traces/trace_01HQ",
      "issueLink": "https://sentry.example/organizations/campus/issues/123",
      "issueFingerprint": "timeout:supervisor-api"
    }
  ]
}
```

规则：

- payload 只允许 panel-safe deep link / fingerprint
- 不接受 raw issue body、raw trace body、sink query 语句
- `requestId` 与 `traceId` 必须保持 request-scoped correlation

## Explicit Non-Goals

- 不把 `Sentry`、`Axiom`、OpenAI trace / eval tooling 提升成 panel canonical query backend
- 不让 `apps/supervisor-api` 暴露 operator observability HTTP surface
- 不让 panel BFF 查询数据库、audit JSONL 或 sink 后再自己拼 aggregate
- 不把 request observability detail 退化成 raw execution / trace dump
