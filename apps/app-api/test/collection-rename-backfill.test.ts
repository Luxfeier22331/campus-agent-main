// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
	buildCollectionRenameBackfillPlan,
	parseCollectionRenameBackfillArgs,
	resolveCollectionRename,
	resolveProjectionReplayEventType,
	rewriteResolvedScope,
	rewriteScopeSummary,
} from "../scripts/collection-rename-backfill";

describe("collection rename backfill helpers", () => {
	it("rewrites legacy regulation collection names in resolved scope carriers only", () => {
		expect(resolveCollectionRename("student_handbook")).toBe("student_rules");
		expect(resolveCollectionRename("institutional_regulations")).toBe("institutional_rules");
		expect(resolveCollectionRename("curriculum_plan")).toBeNull();

		expect(
			rewriteResolvedScope({
				collection: "student_handbook",
				corpus: "regulations",
				versionMode: "current",
			}),
		).toEqual({
			collection: "student_rules",
			corpus: "regulations",
			versionMode: "current",
		});
		expect(
			rewriteResolvedScope({
				collection: "student_handbook",
				corpus: "curriculum",
			}),
		).toEqual({
			collection: "student_handbook",
			corpus: "curriculum",
		});
		expect(rewriteScopeSummary("regulations/student_handbook")).toBe("regulations/student_rules");
		expect(rewriteScopeSummary("curriculum/curriculum_plan")).toBe("curriculum/curriculum_plan");
	});

	it("maps durable request status to the replay event type", () => {
		expect(resolveProjectionReplayEventType("accepted")).toBe("request.accepted");
		expect(resolveProjectionReplayEventType("completed")).toBe("request.completed");
		expect(resolveProjectionReplayEventType("needs_clarification")).toBe(
			"request.needs_clarification",
		);
		expect(resolveProjectionReplayEventType("no_answer")).toBe("request.no_answer");
		expect(resolveProjectionReplayEventType("error")).toBe("request.error");
		expect(resolveProjectionReplayEventType("approval_required")).toBe(
			"request.approval_required",
		);
		expect(resolveProjectionReplayEventType("rejected")).toBe("request.rejected");
	});

	it("builds a backfill plan that only rewrites resolved-side truth", () => {
		expect(
			buildCollectionRenameBackfillPlan({
				gradeCollection: "student_handbook",
				requestId: "req_01HQ",
				requestStatus: "completed",
				resolvedScopeJson: {
					collection: "student_handbook",
					corpus: "regulations",
				},
				resolvedScopeSummary: "regulations/student_handbook",
				runtimeCollection: "student_handbook",
			}),
		).toEqual({
			hasChanges: true,
			nextGradeCollection: "student_rules",
			nextResolvedScopeJson: {
				collection: "student_rules",
				corpus: "regulations",
			},
			nextResolvedScopeSummary: "regulations/student_rules",
			nextRuntimeCollection: "student_rules",
			replayEventType: "request.completed",
			requestId: "req_01HQ",
			requestStatus: "completed",
		});
	});

	it("parses audit, apply, and replay subcommands", () => {
		expect(parseCollectionRenameBackfillArgs(["audit"])).toEqual({
			command: "audit",
		});
		expect(parseCollectionRenameBackfillArgs(["apply", "--batch-size", "25"])).toEqual({
			batchSize: 25,
			command: "apply",
		});
		expect(
			parseCollectionRenameBackfillArgs([
				"replay-projections",
				"--request-id",
				"req_a",
				"--request-id",
				"req_b",
			]),
		).toEqual({
			command: "replay-projections",
			requestIds: ["req_a", "req_b"],
		});
	});
});
