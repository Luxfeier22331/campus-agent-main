import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RequestDiagnostics } from "../src/app/request-diagnostics";
import { toExecutionDiagnostics } from "../src/server/ops-status/mapping/execution";
import { opsRequestDetailFixture } from "../src/shared/ops-fixtures";
import {
	requestRow,
	runAttemptRow,
	runDiagnostics,
	runStepRow,
} from "./ops-status-store-test-helpers";

describe("memory recovery diagnostics", () => {
	it.each(["completed", "failed"])("renders the current %s memory outcome", (status) => {
		const failure = {
			code: "hindsight_append_failed",
			operation: "memory.append",
			detail: "Upstream unavailable",
			http_status: 503,
		};
		const execution = toExecutionDiagnostics(
			requestRow(),
			runDiagnostics({
				steps: [
					runStepRow({
						stepId: "memory.append",
						stepKind: "memory",
						activityAttempt: status === "completed" ? 2 : 1,
						status,
						sanitizedPayloadJson: status === "completed" ? {} : { failure },
					}),
				],
				attempts: [
					runAttemptRow({
						stepId: "memory.append",
						status: "failed",
						sanitizedPayloadJson: { failure },
					}),
				],
			}),
		);
		render(<RequestDiagnostics detail={{ ...opsRequestDetailFixture, execution }} />);
		if (status === "completed") {
			expect(screen.queryByTestId("request-failure-facts")).not.toBeInTheDocument();
			expect(screen.queryByText(failure.detail)).not.toBeInTheDocument();
		} else {
			const summary = within(screen.getByTestId("request-failure-facts"));
			expect(summary.getByText(failure.detail)).toBeVisible();
			expect(summary.getByText("503")).toBeVisible();
		}
		expect(screen.queryByRole("region", { name: "回答终态失败" })).not.toBeInTheDocument();
	});
});
