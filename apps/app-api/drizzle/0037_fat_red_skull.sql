ALTER TABLE "operator"."eval_diagnostic_badcase_projection"
ADD COLUMN "trajectory_attribution_json" jsonb DEFAULT '{
    "status": "trajectory_missing",
    "stepId": null,
    "stepKind": null,
    "tool": null,
    "toolName": null,
    "stepStatus": null,
    "outcome": {
        "failCloseReason": null,
        "terminalReason": null,
        "replanReason": null,
        "cancelOutcome": null,
        "timeoutOutcome": null,
        "lateCompletionOutcome": null
    },
    "projectionRefs": []
}'::jsonb NOT NULL;
