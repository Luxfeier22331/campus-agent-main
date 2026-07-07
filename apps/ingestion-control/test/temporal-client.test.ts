import { WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import { describe, expect, it } from "vitest";
import { isWorkflowAlreadyStartedError } from "../src/temporal-client.ts";

describe("ingestion temporal client", () => {
	it("recognizes Temporal already-started errors by SDK type", () => {
		const error = new WorkflowExecutionAlreadyStartedError(
			"Workflow execution already started",
			"workflow-1",
			"ingestionTaskWorkflow",
		);

		expect(isWorkflowAlreadyStartedError(error)).toBe(true);
	});

	it("does not classify arbitrary name or message collisions as already started", () => {
		expect(
			isWorkflowAlreadyStartedError({
				name: "WorkflowExecutionAlreadyStartedError",
				message: "not from Temporal SDK",
			}),
		).toBe(false);
		expect(isWorkflowAlreadyStartedError(new Error("WorkflowExecutionAlreadyStarted"))).toBe(false);
	});
});
