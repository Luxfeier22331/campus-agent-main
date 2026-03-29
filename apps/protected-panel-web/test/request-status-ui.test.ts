import { describe, expect, it } from "vitest";

import { formatStatusLabel } from "../src/panel/requests/request-formatters";
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
});
