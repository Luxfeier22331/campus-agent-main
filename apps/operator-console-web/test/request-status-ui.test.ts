import { describe, expect, it } from "vitest";

import {
	buildRequestDiagnosticEntries,
	buildRequestStepTrajectoryEntries,
	formatRequestDiagnosticReason,
	formatStatusLabel,
	formatSurfaceLabel,
} from "../src/panel/requests/request-formatters";
import * as requestListModule from "../src/panel/requests/request-list";
import {
	RequestSourceDocumentChips,
	RequestStatusChip,
} from "../src/panel/requests/request-presenters";

describe("Operator Console request status ui", () => {
	it("formats approval-required and rejected projection statuses with operator-facing labels", () => {
		expect(formatStatusLabel("approval_required")).toBe("待审批");
		expect(formatStatusLabel("rejected")).toBe("已拒绝");
	});

	it("renders chip severity for approval-required and rejected statuses", () => {
		const approvalRequiredChip = RequestStatusChip({ status: "approval_required" });
		const rejectedChip = RequestStatusChip({ status: "rejected" });

		expect(approvalRequiredChip.props.color).toBe("warning");
		expect(approvalRequiredChip.props.label).toBe("待审批");
		expect(rejectedChip.props.color).toBe("error");
		expect(rejectedChip.props.label).toBe("已拒绝");
	});

	it("deduplicates repeated source document ids before rendering chips", () => {
		const chips = RequestSourceDocumentChips({
			sourceDocIds: [
				"program_semester_facts:法学（民族实验班）本科人才培养方案:semester-4",
				"program_semester_facts:法学（民族实验班）本科人才培养方案:semester-4",
			],
		});

		expect(chips.props.children).toHaveLength(1);
		expect(chips.props.children[0].key).toBe(
			"program_semester_facts:法学（民族实验班）本科人才培养方案:semester-4",
		);
	});

	it("offers chinese request filter labels for operator use", () => {
		const statusChoices = (
			requestListModule as {
				REQUEST_STATUS_CHOICES?: Array<{ id: string; name: string }>;
			}
		).REQUEST_STATUS_CHOICES;

		expect(statusChoices).toEqual([
			{ id: "accepted", name: "已受理" },
			{ id: "completed", name: "已完成" },
			{ id: "needs_clarification", name: "待澄清" },
			{ id: "approval_required", name: "待审批" },
			{ id: "rejected", name: "已拒绝" },
			{ id: "no_answer", name: "无法回答" },
			{ id: "error", name: "错误" },
		]);
	});

	it("formats handbook diagnostic reason codes into chinese operator-facing labels", () => {
		expect(formatRequestDiagnosticReason("policy_object_missing")).toBe("未找到政策对象");
		expect(formatRequestDiagnosticReason("policy_object_conflict")).toBe("政策对象冲突");
		expect(formatRequestDiagnosticReason("resolved_policy_clause_not_found")).toBe(
			"未找到命中的政策条款",
		);
	});

	it("formats request surfaces with chinese labels", () => {
		expect(formatSurfaceLabel("public_chat_web")).toBe("公开聊天网页");
		expect(formatSurfaceLabel("operator_console_web")).toBe("受保护运维面板");
	});

	it("builds display rows for handbook request diagnostics only when values are present", () => {
		expect(
			buildRequestDiagnosticEntries({
				clarificationReason: null,
				noAnswerReason: "resolved_policy_clause_not_found",
				resolvedPolicyDocumentId: "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
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
				label: "命中政策",
				value:
					"中央民族大学本科学生国家奖学金评审办法 (handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15)",
			},
			{
				label: "重写后的问题",
				value:
					"中央民族大学本科学生国家奖学金评审办法 民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
			},
			{
				label: "无法回答原因",
				value: "未找到命中的政策条款",
			},
			{
				label: "召回标题",
				value: "中央民族大学本科学生国家奖学金评审办法 · 中央民族大学本科学生综合素质测评办法",
			},
		]);
	});

	it("builds durable step trajectory rows without exposing raw payload fields", () => {
		const entries = buildRequestStepTrajectoryEntries({
			attemptCount: 3,
			resultCount: 3,
			steps: [
				{
					attemptCount: 1,
					capability: "knowledge",
					cancelOutcome: "not_requested",
					durationMs: 100,
					estimatedCostMicrousd: 321,
					failCloseReason: "current_state_unverifiable",
					inputTokens: 120,
					lateCompletionOutcome: "ignored_after_timeout",
					latestResultRef: "projection://runs/run_01HQ/planning",
					modelName: "gpt-5-mini",
					modelProvider: "openai",
					outputTokens: 42,
					providerRequestRef: "provider://requests/req_001",
					queueWaitMs: 25,
					replanReason: "bounded_replan_after_provider_timeout",
					resultCount: 1,
					status: "completed",
					stepId: "planning",
					stepKind: "planning",
					taskQueue: "campus-agent.activity.knowledge.plan",
					timeoutOutcome: "not_timed_out",
					workerId: "staging:activity-knowledge-plan:001",
				},
				{
					attemptCount: 1,
					capability: "knowledge",
					cancelOutcome: "not_requested",
					durationMs: 45,
					estimatedCostMicrousd: 0,
					failCloseReason: null,
					inputTokens: 0,
					lateCompletionOutcome: "not_late",
					latestResultRef: "projection://runs/run_01HQ/retrieval/indexed-lookup",
					modelName: null,
					modelProvider: null,
					outputTokens: 0,
					providerRequestRef: null,
					queueWaitMs: 35,
					replanReason: null,
					resultCount: 1,
					status: "completed",
					stepId: "retrieval.indexed_lookup",
					stepKind: "retrieval.indexed_lookup",
					taskQueue: "campus-agent.activity.knowledge.retrieval",
					timeoutOutcome: "not_timed_out",
					workerId: "staging:activity-knowledge-retrieval:001",
				},
				{
					attemptCount: 1,
					capability: "knowledge",
					cancelOutcome: "not_requested",
					durationMs: 250,
					estimatedCostMicrousd: 640,
					failCloseReason: null,
					inputTokens: 220,
					lateCompletionOutcome: "not_late",
					latestResultRef: "projection://runs/run_01HQ/synthesis",
					modelName: "gpt-5-mini",
					modelProvider: "openai",
					outputTokens: 80,
					providerRequestRef: "provider://requests/req_002",
					queueWaitMs: 20,
					replanReason: null,
					resultCount: 1,
					status: "completed",
					stepId: "synthesis",
					stepKind: "synthesis",
					taskQueue: "campus-agent.activity.knowledge.synthesis",
					timeoutOutcome: "not_timed_out",
					workerId: "staging:activity-knowledge-synthesis:001",
				},
				{
					attemptCount: 1,
					capability: "knowledge",
					cancelOutcome: "not_requested",
					durationMs: 25,
					estimatedCostMicrousd: 0,
					failCloseReason: null,
					inputTokens: 0,
					lateCompletionOutcome: "not_late",
					latestResultRef: "projection://runs/run_01HQ/grounding/verify",
					modelName: null,
					modelProvider: null,
					outputTokens: 0,
					providerRequestRef: null,
					queueWaitMs: 8,
					replanReason: null,
					resultCount: 1,
					status: "completed",
					stepId: "grounding.verify",
					stepKind: "grounding.verify",
					taskQueue: "campus-agent.activity.knowledge.plan",
					timeoutOutcome: "not_timed_out",
					workerId: "staging:activity-knowledge-plan:001",
				},
				{
					attemptCount: 1,
					capability: "finalization",
					cancelOutcome: "not_requested",
					durationMs: 30,
					estimatedCostMicrousd: 0,
					failCloseReason: null,
					inputTokens: 0,
					lateCompletionOutcome: "not_late",
					latestResultRef: "projection://runs/run_01HQ/finalization/write",
					modelName: null,
					modelProvider: null,
					outputTokens: 0,
					providerRequestRef: null,
					queueWaitMs: 10,
					replanReason: null,
					resultCount: 1,
					status: "completed",
					stepId: "finalization.write",
					stepKind: "finalization.write",
					taskQueue: "campus-agent.activity.finalization",
					timeoutOutcome: "not_timed_out",
					workerId: "staging:finalization:worker-1",
				},
			],
		});

		expect(entries[0]).toEqual({
			kind: "summary",
			metrics: "5 steps · attempts=3 · results=3",
		});
		expect(entries.slice(1).map((entry) => (entry.kind === "step" ? entry.stepId : ""))).toEqual([
			"planning",
			"retrieval.indexed_lookup",
			"synthesis",
			"grounding.verify",
			"finalization.write",
		]);
		expect(entries[1]).toMatchObject({
			attempts: "attempts=1 · results=1",
			capability: "knowledge",
			diagnosticGroups: [
				{
					items: ["cancel=not_requested", "timeout=not_timed_out", "late=ignored_after_timeout"],
					kind: "runtime",
				},
				{
					items: ["fail_close=current_state_unverifiable"],
					kind: "terminal",
				},
				{
					items: ["replan=bounded_replan_after_provider_timeout"],
					kind: "replan",
				},
			],
			diagnostics: [
				"cancel=not_requested",
				"timeout=not_timed_out",
				"late=ignored_after_timeout",
				"fail_close=current_state_unverifiable",
				"replan=bounded_replan_after_provider_timeout",
			],
			duration: "queue=25 ms · duration=100 ms",
			kind: "step",
			latestResultRef: "projection://runs/run_01HQ/planning",
			model: "openai/gpt-5-mini",
			providerRequestRef: "provider://requests/req_001",
			status: "completed",
			stepKind: "planning",
			taskQueue: "campus-agent.activity.knowledge.plan",
			tokenCost: "tokens=120/42 · 321 microUSD",
			workerId: "staging:activity-knowledge-plan:001",
		});
		expect(JSON.stringify(entries)).not.toContain("raw");
		expect(JSON.stringify(entries)).not.toContain("semantic.rag");
	});
});
