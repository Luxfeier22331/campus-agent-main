import { describe, expect, it } from "vitest";
import type {
	TaskPlanStep,
	WorkflowOperationInput,
	WorkflowOperationResult,
} from "../src/agent-run-contract.ts";
import { normalizeStageResult, planIssue } from "../src/operation-rules.ts";
import type { AgentWorkflowInput } from "../src/temporal-contract.ts";

const admission = {
	agent_budget: { max_plan_steps: 3 },
	agent_capabilities: { visible_function_tool_names: ["campus_search"], hosted_web_search: true },
} as AgentWorkflowInput["admission_snapshot"];
const step = (id: string, dependsOn: string[] = []): TaskPlanStep => ({
	id,
	objective: "查找资料",
	candidateSources: ["campus_search"],
	dependsOn,
});
const usage = {
	inputTokens: 12,
	outputTokens: 6,
	cachedInputTokens: 0,
	modelRequestCount: 1,
	usageObserved: true,
};
function result(operation: WorkflowOperationResult["operation"]): WorkflowOperationResult {
	return {
		operation,
		status: "completed",
		finalOutput: "answer",
		evidence: [],
		sourceAttempts: [],
		toolResults: [],
		usage,
		terminalReason: "operation_completed",
	} as unknown as WorkflowOperationResult;
}
describe("Runtime operation rules", () => {
	for (const [name, steps] of [
		["unavailable source", [{ ...step("step.a"), candidateSources: ["personal_memory_recall"] }]],
		["duplicate", [step("step.a"), step("step.a")]],
		["cycle", [step("step.a", ["step.b"]), step("step.b", ["step.a"])]],
		["unknown dependency", [step("step.a", ["step.missing"])]],
		["budget", [step("step.a"), step("step.b"), step("step.c"), step("step.d")]],
	] as [string, TaskPlanStep[]][]) {
		it(`rejects ${name}`, () => {
			expect(planIssue([...steps] as TaskPlanStep[], admission)).toBeDefined();
		});
	}
	it("accepts dependencies on completed steps", () => {
		expect(planIssue([step("step.b", ["step.a"])], admission, ["step.a"])).toBeUndefined();
	});
	for (const remainingSteps of [
		[],
		[step("step.a")],
		[step("step.b", ["step.c"]), step("step.c")],
	] as TaskPlanStep[][]) {
		it("rejects invalid replan while preserving model usage", () => {
			const input = {
				operation: "replan",
				operationInput: { completedSteps: [{ step: step("step.a") }] },
			} as WorkflowOperationInput;
			const output = normalizeStageResult(
				input,
				{
					...result("replan"),
					replan: {
						schemaVersion: "task_replan.v3",
						decision: "continue",
						reason: "more",
						remainingSteps,
					},
				},
				admission,
			);
			expect(output.status).toBe("failed");
			expect(output.failure?.code).toBe("model_output_invalid");
			expect(output.replan).toBeUndefined();
			expect(output.usage).toEqual(usage);
		});
	}
	for (const [code, httpStatus, accepted] of [
		["campus_search_timeout", undefined, true],
		["tool_handler_failed", 429, true],
		["tool_handler_failed", 503, true],
		["tool_handler_failed", 400, false],
		["tool_contract_mismatch", undefined, false],
	] as const) {
		it(`preserves tool failure classification: ${code}/${httpStatus}`, () => {
			const input = { operation: "solve" } as WorkflowOperationInput;
			const original = {
				...result("solve"),
				solveOutcome: "answer",
				toolResults: [
					{ toolName: "campus_search", status: "failed", failure: { code, httpStatus } },
				],
			} as WorkflowOperationResult;
			const output = normalizeStageResult(input, original, admission);
			expect(output.status).toBe(accepted ? "completed" : "failed");
			expect(output.usage).toEqual(usage);
		});
	}
	it("validates sources on failed results as well as successful results", () => {
		const original = {
			...result("solve"),
			status: "failed",
			evidence: [{ source: "personal_memory_recall" }],
		} as WorkflowOperationResult;
		const output = normalizeStageResult(
			{ operation: "solve" } as WorkflowOperationInput,
			original,
			admission,
		);
		expect(output.failure?.code).toBe("workflow_operation_result_invalid");
		expect(output.evidence).toEqual([]);
	});
	it("rejects retrieval output from a replanning operation", () => {
		const original = {
			...result("replan"),
			status: "failed",
			sourceAttempts: [{ source: "campus_search", status: "no_match" }],
		} as WorkflowOperationResult;
		expect(
			normalizeStageResult({ operation: "replan" } as WorkflowOperationInput, original, admission)
				.failure?.code,
		).toBe("workflow_operation_result_invalid");
	});
	it("synthesis carries admitted materials on success and failure", () => {
		const evidence = [{ id: "source", title: "资料", excerpt: "正文", source: "campus_search" }];
		const sourceAttempts = [{ source: "campus_search", status: "matched" }];
		const input = {
			operation: "synthesize",
			operationInput: { evidence, sourceAttempts },
		} as WorkflowOperationInput;
		for (const status of ["completed", "failed"] as const) {
			const output = normalizeStageResult(input, { ...result("synthesize"), status }, admission);
			expect(output.evidence).toEqual(evidence);
			expect(output.sourceAttempts).toEqual(sourceAttempts);
			expect(output.status).toBe(status);
		}
	});
});
