---
doc_type: contract
truth_scope: ops
owner_boundary: apps/app-api
status: active
created: 2026-06-13
updated: 2026-06-13
---

# App API Operator Observability Quality HTTP

<!-- markdownlint-disable MD013 -->

Split from the operator observability requests/quality document during
documentation SoT cleanup. The parent path remains the stable index.

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
    "feedback": {
      "feedbackCount": 82,
      "coverageRate": {
        "value": 0.0657,
        "count": 82,
        "eligibleCount": 1248
      },
      "helpfulRate": {
        "value": 0.7561,
        "count": 62,
        "eligibleCount": 82
      },
      "unhelpfulRate": {
        "value": 0.2439,
        "count": 20,
        "eligibleCount": 82
      },
      "noAnswerUnhelpfulRate": {
        "value": 0.1311,
        "count": 8,
        "eligibleCount": 61
      },
      "distributions": {
        "surface": [{ "value": "campus_web", "count": 82 }],
        "answerKind": [
          { "value": "answer", "count": 56 },
          { "value": "no_answer", "count": 18 },
          { "value": "clarification", "count": 8 }
        ],
        "tool": [{ "value": "knowledge", "count": 64 }],
        "citationPosture": [
          { "value": "citation_present", "count": 48 },
          { "value": "citation_missing", "count": 8 },
          { "value": "citation_not_expected", "count": 26 }
        ],
        "reasonCode": [{ "value": "wrong_intent", "count": 7 }],
        "vote": [
          { "value": "helpful", "count": 62 },
          { "value": "unhelpful", "count": 20 }
        ]
      }
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
    "intentPassRate": {
      "value": 0.95,
      "count": 19,
      "eligibleCount": 20
    },
    "badcaseOpenCount": 7
  },
  "asOf": "2026-04-03T00:00:10.000Z"
}
```

规则：

- `runtime` 与 `sampledGrades` 必须分块返回，不混成单一 truth
- `runtime.feedback` 来自 `chat.message_feedback.request_id` 与
  `runtime.request_observability_fact.request_id` 的 app-api owned join；时间窗、surface、
  selected tool、tool、principal、collection 与 model 过滤均以 request observability
  fact 为准，不以 feedback `updatedAt` 重新定义窗口
- `runtime.feedback.coverageRate.eligibleCount` 只统计可投票 assistant answer：`completed`、
  `needs_clarification` 与 `no_answer`；`error`、`rejected`、`approval_required` 不进入分母
- `runtime.feedback.helpfulRate` 与 `runtime.feedback.unhelpfulRate` 的分母是当前窗口内已收到
  feedback 的 eligible answer 数
- `runtime.feedback.noAnswerUnhelpfulRate` 的分母是当前窗口内 `status=no_answer` 的 eligible
  answer 数
- `runtime.feedback.distributions` 只基于已收到 feedback 且可 join 到 eligible answer 的记录；
  reason code 缺失时允许返回 `unspecified`
- sampled grading 缺失时，`sampledGrades` 允许为空块或 `null` 值，不得用 runtime 指标冒充 grader 结果
- 当前已冻结的第一版 contract 返回 `sampledGrades: null`
- forward contract 上，`sampledGrades` 的上游固定为 `operator.quality_grade_projection`
- `sampledGrades.intentPassRate` 只来自 `gradeDomain=intent` 的人工复核或 sampled
  grader，不得由最终 answer quality 反推

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
      "feedbackEligibleAnswerCount": 52,
      "feedbackCount": 4,
      "feedbackCoverageRate": 0.0769,
      "feedbackHelpfulCount": 3,
      "feedbackHelpfulRate": 0.75,
      "feedbackUnhelpfulCount": 1,
      "feedbackUnhelpfulRate": 0.25,
      "feedbackNoAnswerEligibleCount": 3,
      "feedbackNoAnswerUnhelpfulCount": 1,
      "feedbackNoAnswerUnhelpfulRate": 0.3333,
      "sampledGroundingPassRate": 0.9
    }
  ],
  "asOf": "2026-04-03T00:00:10.000Z"
}
```

规则：

- timeseries bucket 只返回 app-owned aggregate，不内嵌 raw request rows
- feedback timeseries 字段使用同 summary 相同的 eligible answer、feedback count、helpful /
  unhelpful 与 no-answer-unhelpful 分母口径；它们随 bucket 展示 denominator 字段，避免前端推算
- sampled grade 相关曲线允许出现 `null`，表示该 bucket 没有足够样本
- 当前已冻结的第一版 contract 由 `operator.metric_rollup` 重建 `requestCount`、`emptyRecallRa
  te`、`citationMissRate`、`noAnswerRate`、`needsClarificationRate`
- 当前已冻结的第一版 contract 中，`sampledGroundingPassRate` 固定为 `null`
- forward contract 上，`sampledGroundingPassRate` 的上游固定为
  `operator.quality_grade_projection` 与 request bucket join

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
      "surface": "campus_web",
      "selectedTool": "knowledge_query",
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
- 当前已冻结的第一版 contract 只支持 `status` / `causeClass` / `detectedBy` 过滤，不按 sink
  backlink 或 grader 结果过滤
- 当前已冻结的第一版 contract 中，`detectedBy` 固定来自 `runtime_monitor`
- 当前已冻结的第一版 contract 中，`causeClass` 已落地
  `citation_missing`、`empty_recall`、`grounding_failed`、
  `unsupported_by_evidence`、`policy_failed`、`authz_suspected` 与
  `freshness_fail_close`
- `grade` 与 `links` 允许全部为 `null`；当 request lifecycle 或 internal producer
  已写入 app-owned projection 时，panel 返回对应的 safe backlink
- forward contract 上，`grade` 的上游固定为
  `operator.quality_grade_projection`，`links.*` 的上游固定为
  `operator.trace_backlink_projection`

### `GET /api/operator/quality/eval-candidates`

查询参数与 `quality/badcases` 相同，并允许用 `detectedBy=negative_feedback` 只看用户负反馈候选，
或用 `detectedBy=ragas_diagnostic` 只看 RAGAS diagnostic low-score 候选：

- `limit`
- `cursor`
- `status`
- `causeClass`
- `detectedBy`

响应：

```json
{
  "candidates": [
    {
      "candidateId": "eval_candidate:req_01HQ:unsupported_by_evidence",
      "requestId": "req_01HQ",
      "traceId": "trace_01HQ",
      "surface": "campus_web",
      "selectedTool": "knowledge_query",
      "causeClass": "unsupported_by_evidence",
      "summary": "semanticOutcome=unsupported_by_evidence 或存在 unsupported claims",
      "grade": {
        "result": "fail",
        "score": 0.25,
        "graderVersion": "grader@2026-04-03"
      },
      "links": {
        "traceLink": "https://sentry.example/organizations/campus/traces/trace_01HQ",
        "issueLink": null,
        "issueFingerprint": "unsupported-by-evidence"
      },
      "intake": {
        "source": "operator_badcase",
        "status": "pending_review",
        "suggestedEvalFamily": "grounding",
        "createdAt": "2026-04-03T00:10:00.000Z"
      }
    },
    {
      "candidateId": "eval_candidate:negative_feedback:feedback_01HQ",
      "requestId": "req_01HQ",
      "traceId": "trace_01HQ",
      "surface": "campus_web",
      "selectedTool": "knowledge_query",
      "causeClass": "wrong_intent",
      "summary": "Negative answer feedback for answer: wrong_intent.",
      "grade": null,
      "links": {
        "traceLink": "https://sentry.example/organizations/campus/traces/trace_01HQ",
        "issueLink": null,
        "issueFingerprint": null
      },
      "correlation": {
        "conversationId": "conv_01HQ",
        "assistantMessageId": "msg_assistant_01HQ",
        "answerKind": "answer",
        "citationPosture": "citation_missing",
        "intent": {
          "tool": "knowledge_query",
          "taskKind": "knowledge_lookup",
          "launchState": "open",
          "nextAction": "delegate",
          "scopeClass": "in_scope",
          "classifierVersion": "intent-classifier@2026-04-20"
        }
      },
      "feedback": {
        "feedbackId": "feedback_01HQ",
        "vote": "unhelpful",
        "reasonCodes": ["wrong_intent"],
        "updatedAt": "2026-04-03T00:12:00.000Z"
      },
      "review": {
        "suggestedLabels": ["wrong_intent"]
      },
      "privacy": {
        "rawTranscriptIncluded": false,
        "rawAuthMaterialIncluded": false,
        "providerRawResponseIncluded": false
      },
      "intake": {
        "source": "negative_feedback",
        "status": "pending_review",
        "suggestedEvalFamily": "intent",
        "createdAt": "2026-04-03T00:12:00.000Z"
      }
    },
    {
      "candidateId": "eval_candidate:ragas_diagnostic:student-scholarship-condition:faithfulness",
      "requestId": null,
      "traceId": null,
      "surface": "regulations/student_rules",
      "selectedTool": null,
      "causeClass": "evidence_selection_failed",
      "summary": "RAGAS faithfulness=0.31 below 0.80 at evidence_selection.",
      "grade": {
        "result": "fail",
        "score": 0.31,
        "graderVersion": "ragas-diagnostic-combined-report.v1"
      },
      "links": {
        "traceLink": null,
        "issueLink": null,
        "issueFingerprint": null
      },
      "diagnostic": {
        "caseId": "student-scholarship-condition",
        "metricName": "faithfulness",
        "score": 0.31,
        "threshold": 0.8,
        "failureStage": "evidence_selection",
        "metricFailureReason": "evidence_selection",
        "expectedDocIds": ["doc:scholarship"],
        "retrievedContextIds": ["chunk:wrong", "chunk:scholarship"],
        "retrievedDocIds": ["doc:wrong", "doc:scholarship"],
        "supportingDocIds": ["doc:wrong"],
        "answerShape": "eligibility_judgment",
        "presentationKind": "condition_table"
      },
      "intake": {
        "source": "ragas_diagnostic",
        "status": "pending_review",
        "suggestedEvalFamily": "grounding",
        "createdAt": "2026-05-21T09:00:00.000Z"
      }
    }
  ],
  "page": {
    "nextCursor": null
  }
}
```

规则：

- 这是 app-api-owned badcase-to-eval intake export seam，不是 eval golden set
  admission API
- `candidateId` 对 badcase 稳定派生自 `badcaseId`；对 negative feedback 稳定派生自
  `feedbackId`；对 RAGAS diagnostic 稳定派生自 `badcaseId`，便于后续 eval tooling 做幂等 intake
- `intake.source` 当前允许 `operator_badcase`、`negative_feedback` 或
  `ragas_diagnostic`
- `suggestedEvalFamily` 只表达 app-api 基于 `causeClass` 的初始归类；eval review / golden set
  admission 仍由 eval layer 决定
- `suggestedEvalFamily` 当前取值为 `citation`、`grounding`、`intent`、`policy` 或 `unknown`
- negative feedback candidate 的 manual review label 当前允许：
  `false_positive`、`false_negative`、`wrong_intent`、`stale_missing_evidence`、
  `answer_style_issue`
- negative feedback candidate 只返回 request/message correlation、intent summary、
  citation/source posture、reason codes 与 trace backlink；不得返回 raw transcript、
  raw auth material、provider raw response、raw prompt 或 retrieval payload
- RAGAS diagnostic candidate 不携带 runtime request / trace correlation；`requestId`、
  `traceId`、`selectedTool` 和 `links.*` 固定允许为 `null`，panel 不得把它渲染成运行时
  request 链接
- RAGAS diagnostic candidate 只返回 case / metric / failure stage / doc id 摘要；
  不得返回 raw answer、raw prompt、transcript、local artifact path、bucket / object key、
  auth material 或 provider raw response
- `packages/evals` 的 eval admission manifest 只能把这些 candidate 包装成
  `pending_review`，不能直接把它们写成 golden truth
- endpoint 不写入 eval truth，不生成 benchmark artifact，不创建 fix task
