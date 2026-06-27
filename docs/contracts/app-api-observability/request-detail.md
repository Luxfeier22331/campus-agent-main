---
doc_type: contract
truth_scope: ops
owner_boundary: apps/app-api
status: active
created: 2026-06-13
updated: 2026-06-13
---

# App API Operator Observability Request Detail HTTP

<!-- markdownlint-disable MD013 -->

Split from the operator observability requests/quality document during
documentation SoT cleanup. The parent path remains the stable index.

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
    "surface": "campus_web",
    "status": "completed",
    "requestedTool": "knowledge_query",
    "requestedScope": null,
    "versionQuery": {
      "mode": "compare",
      "versionId": "v2024-student-rules",
      "compareToVersionId": "v2025-student-rules"
    },
    "resolvedScope": {
      "corpus": "curriculum",
      "collection": "curriculum_plan"
    },
    "selectedTool": "knowledge_query",
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
    "versionQueryMode": "compare",
    "versionQuerySummary": "compare:v2024-student-rules->v2025-student-rules",
    "retrievalPlan": {
      "planId": "curriculum:curriculum_plan:current",
      "queryMode": "current",
      "replanCount": 0,
      "terminalState": "completed",
      "stepActivities": [
        {
          "stepId": "indexed-lookup",
          "stepType": "indexed_lookup",
          "corpus": "curriculum",
          "collection": "curriculum_plan",
          "status": "succeeded",
          "topK": 8,
          "latencyMs": 18,
          "candidateCount": 4,
          "referenceCount": 4,
          "failureKind": null
        }
      ]
    },
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
  "runtimeRun": {
    "run": {
      "runId": "run_01HQ",
      "requestId": "req_01HQ",
      "conversationId": "conv_01HQ",
      "traceId": "trace_01HQ",
      "status": "completed",
      "phase": "completed",
      "terminalReason": "completed"
    },
    "eventSummary": {
      "eventCount": 9,
      "latestEvent": {
        "sequence": 9,
        "eventType": "finalization.completed",
        "visibility": "browser",
        "occurredAt": "2026-04-03T00:00:00.842Z"
      },
      "terminalEvent": {
        "sequence": 9,
        "eventType": "finalization.completed",
        "visibility": "browser",
        "occurredAt": "2026-04-03T00:00:00.842Z"
      },
      "visibilityCounts": {
        "browser": 3,
        "panel": 2,
        "eval": 1,
        "internal": 3
      }
    },
    "stepTrajectory": {
      "attemptCount": 3,
      "resultCount": 3,
      "steps": [
        {
          "stepId": "context.memory_recall",
          "stepKind": "memory.recall",
          "tool": "context",
          "status": "succeeded",
          "taskQueue": "activity-core",
          "workerId": "staging:context:01",
          "attemptCount": 1,
          "resultCount": 1,
          "queueWaitMs": 12,
          "durationMs": 24,
          "modelProvider": null,
          "modelName": null,
          "inputTokens": 0,
          "outputTokens": 0,
          "estimatedCostMicrousd": 0,
          "providerRequestRef": null,
          "cancelOutcome": null,
          "timeoutOutcome": null,
          "latestResultRef": "projection://runs/run_01HQ/steps/context.memory_recall/result"
        }
      ]
    }
  },
  "links": {
    "traceLink": "https://sentry.example/organizations/campus/traces/trace_01HQ",
    "issueLink": null,
    "issueFingerprint": null
  },
  "replay": {
    "context": {
      "principalType": "student",
      "entitlementSnapshotId": "ent_01HQ",
      "entitlementGroups": ["students"],
      "visibilityScope": "main",
      "applicabilityScope": "undergraduate",
      "policyProjectionVersion": "phase1-authorization-projection-v1"
    },
    "routing": {
      "requestedTool": "knowledge_query",
      "requestedScope": null,
      "resolvedScope": {
        "corpus": "curriculum",
        "collection": "curriculum_plan"
      },
      "selectedTool": "knowledge_query"
    },
    "execution": {
      "status": "completed",
      "errorCode": null,
      "semanticOutcome": null,
      "refusalClass": null,
      "scopeClass": null,
      "failClosed": false
    },
    "retrieval": {
      "retrievalAttempted": true,
      "candidateCount": 18,
      "retrievedSourceCount": 4,
      "emptyRecall": false,
      "adequacyVerdict": "sufficient",
      "adequacyReason": "sufficient",
      "plan": {
        "planId": "curriculum:curriculum_plan:current",
        "queryMode": "current",
        "replanCount": 0,
        "terminalState": "completed",
        "stepActivities": []
      },
      "sourceTraceCounts": {
        "retrieved": 1,
        "supporting": 1
      }
    },
    "answerQuality": {
      "citationExpected": true,
      "citationCount": 2,
      "citationMissing": false,
      "claimSupportSummary": null,
      "groundingVerdict": null,
      "groundingDowngraded": null,
      "freshnessFailClosed": null,
      "policyReason": null
    },
    "prompt": {
      "id": "rag_answer_v1",
      "version": "v1",
      "templateSha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "runtimeState": null,
      "runtimeDetail": null
    }
  },
  "auditSummary": {
    "auditEventCount": 5,
    "latestTerminalCode": "completed"
  }
}
```

规则：

- 这是 request-scoped observability summary，不是 raw execution dump
- 不返回 raw prompt、raw answer、raw transcript、raw auth material、raw retrieval
  payload
- `requestedScope` 反映 accept 时上游是否显式约束 scope，可为 `null`
- `request.versionQuery` 反映调用方显式提交的 raw version query；缺失时表示 caller 没有显式覆盖
  current
- `resolvedScope` 反映 execution side 最终命中的 serving surface，是 panel 侧 quality /
  collection 归因的真相源
- `observability.versionQueryMode` / `versionQuerySummary` 是 operator-safe
  摘要，用于区分 `current`、`historical`、`as_of`、`compare` 等请求形态；它们不是 raw planner trace
- `retrievalAttempted`、`citationExpected`、`aclDecision` 必须来自 typed execution
  seam 或 app-owned runtime fact family
- `sourceTrace.retrieved` 表示 bounded raw retrieval candidate
  trace；`sourceTrace.supporting` 表示最终 answer-facing support set
- `sourceTrace.*` 只允许返回 operator-safe compact identity fields，例如
  `docId`、`chunkId`、`score`、`collection`、canonical / source-unit identity；不得返回
  raw snippet dump
- `sourceTrace.supporting[*].canonicalSourceId` 与
  `sourceTrace.supporting[*].sourceUnitKey` 用于显式区分 canonical curriculum identity
  与物理 projection-unit hit
- `retrievalAdequacyVerdict` / `retrievalAdequacyReason` 用于区分 retrieval base 不足与
  post-generation grounding downgrade
- `retrievalPlan` 只暴露 compact plan / step execution summary，例如
  `planId`、`queryMode`、`replanCount`、`terminalState` 与 step-level `status` /
  `latencyMs` / `candidateCount`
- `retrievalPlan` 的来源固定为 request projection 中的
  `diagnosticsJson.retrievalPlanSummary`；它是 operator-safe typed projection，不是
  raw planner trace 或 provider debug payload
- `runtimeRun.operatorStepTrajectory` 是 request detail 的 canonical execution
  diagnostic export；它由 app-api 从 execution-control
  `/internal/execution/runs/:runId/steps` 和 app-owned projection materialize，不由
  panel 从 Temporal history、sink query 或 raw runtime event 反推
- `runtimeRun.stepTrajectory` 只保留 bounded compatibility display summary；panel、
  eval、badcase 与 release-evidence-shaped fixture 必须优先消费
  `operator_step_trajectory.v1`，不得把 `stepTrajectory` 当第二套 truth
- `operatorStepTrajectory.steps[*]` 至少表达 step identity、tool、status、task
  queue、worker id、attempt/result count、queue wait、duration、provider/model、
  token/cost、cancel/timeout/late-completion outcome、fail-close reason、terminal
  reason、replan reason 与 bounded projection refs；当前实现未 materialize 的字段不得由
  panel 猜测补齐
- 缺 required run / step / attempt / result projection state 时，app-api 必须返回 typed
  route error 或缺口诊断；不得静默合成成功 trajectory
- `claimSupportSummary` 只返回 compact 的 claim-level 聚合：总 claim 数、unsupported claim
  type、unsupported field；不返回 raw `claim_supports`、support snippet 或
  provider-native citation/support blob
- `observability.prompt.*` 只暴露 prompt identity 与 typed runtime branch，不返回 raw
  prompt
- token / model 字段必须来自 execution-side typed telemetry seam，不从 sink query 反推
- `links.*` 必须来自 app-owned backlink projection，而不是 route-time sink query
- `replay` 是 operator-safe answer replay view，只重组 request projection、request
  observability fact、audit summary 与 trace backlink 中已有的 typed summary；它不是第二套 truth
- `replay.context` 只返回 principal / entitlement / policy projection 的安全摘要，不返回 raw
  JWT、cookie 或 memory 原文
- `replay.retrieval.sourceTraceCounts` 只给出 replay drill-down 的计数线索；需要具体 source identity
  时继续读取 `observability.sourceTrace.*`
