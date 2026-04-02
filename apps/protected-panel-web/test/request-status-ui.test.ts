import { describe, expect, it } from "vitest";

import {
  buildRequestDiagnosticEntries,
  formatRequestDiagnosticReason,
  formatStatusLabel,
} from "../src/panel/requests/request-formatters";
import { RequestStatusChip } from "../src/panel/requests/request-presenters";
import * as requestListModule from "../src/panel/requests/request-list";

describe("protected panel request status ui", () => {
  it("formats approval-required and rejected projection statuses with operator-facing labels", () => {
    expect(formatStatusLabel("approval_required")).toBe("Approval required");
    expect(formatStatusLabel("rejected")).toBe("Rejected");
  });

  it("renders chip severity for approval-required and rejected statuses", () => {
    const approvalRequiredChip = RequestStatusChip({ status: "approval_required" });
    const rejectedChip = RequestStatusChip({ status: "rejected" });

    expect(approvalRequiredChip.props.color).toBe("warning");
    expect(approvalRequiredChip.props.label).toBe("Approval required");
    expect(rejectedChip.props.color).toBe("error");
    expect(rejectedChip.props.label).toBe("Rejected");
  });

  it("offers approval-required and rejected as request filter choices", () => {
    const statusChoices = (
      requestListModule as {
        REQUEST_STATUS_CHOICES?: Array<{ id: string; name: string }>;
      }
    ).REQUEST_STATUS_CHOICES;

    expect(statusChoices?.map((choice) => choice.id)).toEqual([
      "accepted",
      "completed",
      "needs_clarification",
      "approval_required",
      "rejected",
      "no_answer",
      "error",
    ]);
  });

  it("formats handbook diagnostic reason codes into operator-facing labels", () => {
    expect(formatRequestDiagnosticReason("policy_object_missing")).toBe(
      "Policy object missing",
    );
    expect(formatRequestDiagnosticReason("policy_object_conflict")).toBe(
      "Policy object conflict",
    );
    expect(formatRequestDiagnosticReason("resolved_policy_clause_not_found")).toBe(
      "Resolved policy clause not found",
    );
  });

  it("builds display rows for handbook request diagnostics only when values are present", () => {
    expect(
      buildRequestDiagnosticEntries({
        clarificationReason: null,
        noAnswerReason: "resolved_policy_clause_not_found",
        resolvedPolicyDocumentId:
          "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
        resolvedPolicyTitle: "中央民族大学本科学生国家奖学金评审办法",
        retrievedTitleSummary: [
          "中央民族大学本科学生国家奖学金评审办法",
          "中央民族大学本科学生综合素质测评办法",
        ],
        rewrittenQuery:
          "中央民族大学本科学生国家奖学金评审办法 民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
      }),
    ).toEqual([
      {
        label: "Resolved Policy",
        value:
          "中央民族大学本科学生国家奖学金评审办法 (handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15)",
      },
      {
        label: "Rewritten Query",
        value:
          "中央民族大学本科学生国家奖学金评审办法 民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
      },
      {
        label: "No-answer Reason",
        value: "Resolved policy clause not found",
      },
      {
        label: "Retrieved Titles",
        value:
          "中央民族大学本科学生国家奖学金评审办法 · 中央民族大学本科学生综合素质测评办法",
      },
    ]);
  });
});
