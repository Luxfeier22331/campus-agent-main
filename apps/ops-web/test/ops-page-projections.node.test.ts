import type { OcrTask } from "@campus-agent/document-ocr";
import { describe, expect, it } from "vitest";
import { normalizeUsersReturnPath } from "../src/app/account-admin-navigation";
import { readDiningReviewsSearch } from "../src/app/dining-review-navigation";
import { readEmailAccessSearch } from "../src/app/email-access-navigation";
import { projectOcrResource } from "../src/server/ocr-projection";
import { projectRunningStage, projectTaskStages } from "../src/server/task-stages";

const resource = {
	sourceKey: "image-key",
	kind: "image" as const,
	ordinal: 2,
	displayOrdinal: 0,
	label: "图片1",
};
function task(id: string, status: OcrTask["status"], createdAt: string): OcrTask {
	return {
		id,
		status,
		createdAt,
		updatedAt: createdAt,
		input: { kind: "source", noticeId: "123", key: "image-key", contentType: "image/png" },
		inputSha256: null,
		providerJobId: null,
		configUpdatedAt: createdAt,
		target: {
			baseUrl: "https://paddle.example",
			model: "PaddleOCR-VL-1.6",
			options: {
				useDocOrientationClassify: false,
				useDocUnwarping: false,
				useChartRecognition: false,
			},
		},
		progress: null,
		pageCount: status === "completed" ? 1 : 0,
		error: status === "failed" ? "provider failed" : null,
		result: status === "completed" ? { rawKey: "result", missingImages: [] } : null,
	};
}
describe("OCR effective results", () => {
	it("keeps a successful result while a later attempt fails, and orders ties deterministically", () => {
		const tasks = [
			task("a", "completed", "2026-01-01"),
			task("b", "failed", "2026-01-02"),
			task("c", "submitted", "2026-01-02"),
		];
		const output = projectOcrResource(resource, tasks);
		expect(output.selectedResultId).toBe("a");
		expect(output.batches.map((batch) => batch.id)).toEqual(["c", "b", "a"]);
		expect(output.batches[0]).toMatchObject({
			status: "submitted",
			hasResult: false,
			canResume: true,
		});
		expect(output.batches[1]).toMatchObject({
			status: "failed",
			hasResult: false,
			canResume: false,
		});
		expect(tasks.map((task) => task.id)).toEqual(["a", "b", "c"]);
	});
	it("selects the latest completed result after failures and leaves missing results unavailable", () => {
		expect(
			projectOcrResource(resource, [
				task("a", "failed", "2026-01-01"),
				task("b", "completed", "2026-01-02"),
				task("c", "completed", "2026-01-03"),
			]).selectedResultId,
		).toBe("c");
		expect(
			projectOcrResource(resource, [{ ...task("a", "completed", "2026-01-01"), result: null }])
				.selectedResultId,
		).toBeNull();
	});
});
it("retains separate counts for each pipeline stage and does not invent missing progress", () => {
	expect(
		projectTaskStages({
			collection: { summary: { outcome: "partial", noticesProcessed: 5 } },
			classification: { outcome: "success", classified: 3 },
			cleanup: { outcome: "failed", error: "cleanup failure" },
		}),
	).toEqual([
		{ id: "collection", outcome: "partial", counts: { noticesProcessed: 5 }, error: null },
		{ id: "classification", outcome: "success", counts: { classified: 3 }, error: null },
		{ id: "cleanup", outcome: "failed", counts: {}, error: "cleanup failure" },
	]);
	expect(projectRunningStage("embedNotices", [])).toEqual({
		id: "embedNotices",
		outcome: "running",
		counts: {},
		error: null,
	});
});
it("normalizes shareable filters and permits only actual user-detail return sources", () => {
	expect(
		readDiningReviewsSearch({
			submission_id: "submission",
			q: "food",
			visibility: "hidden",
			cursor: "next",
			reviewId: "review",
		}),
	).toMatchObject({
		targetType: "submission",
		submission_id: "submission",
		q: "food",
		visibility: "hidden",
		cursor: "next",
		reviewId: "review",
	});
	expect(
		readEmailAccessSearch({
			email: "user@example.test",
			kind: "test",
			state: "active",
			cursor: "next",
		}),
	).toMatchObject({ kind: "test", state: "active", cursor: "next" });
	for (const path of [
		"/email-access?kind=test",
		"/dining/submissions/id?from=%2Fdining%2Freports",
	]) {
		expect(normalizeUsersReturnPath(path)).toBe(path);
	}
	expect(normalizeUsersReturnPath("https://external.test/users")).toBe("/users");
});

it("projects waiting activities separately from started work and preserves heartbeat freshness", () => {
	const waiting = projectRunningStage("collectNotices", [], { state: 1, attempt: 1 });
	expect(waiting).toMatchObject({
		counts: {},
		activity: {
			state: "waiting",
			attempt: 1,
			startedAt: null,
			lastHeartbeatAt: null,
			lastFailure: null,
		},
	});
	const running = projectRunningStage(
		"collectNotices",
		[
			{
				phase: "processing",
				processed: 15,
				total: 28,
				processedRange: { from: "2026-09-15", to: "2026-09-16" },
			},
		],
		{
			state: 2,
			attempt: 2,
			lastStartedTime: { seconds: "1791036000", nanos: 0 },
			lastHeartbeatTime: { seconds: "1791036010", nanos: 500000000 },
			lastFailure: { message: "连接超时" },
		},
	);
	expect(running).toMatchObject({
		phase: "processing",
		counts: { processed: 15, total: 28 },
		processedRange: { from: "2026-09-15", to: "2026-09-16" },
		activity: {
			state: "running",
			attempt: 2,
			startedAt: "2026-10-03T14:00:00.000Z",
			lastHeartbeatAt: "2026-10-03T14:00:10.500Z",
			lastFailure: "连接超时",
		},
	});
	expect(
		projectTaskStages({
			collection: {
				processedRange: { from: "2026-09-15", to: "2026-09-16" },
				maintenanceRange: { from: "2024-07-01", to: "2026-09-16" },
				summary: { outcome: "success", noticesProcessed: 15, attachmentsReused: 7 },
			},
			publication: { outcome: "success", notices: 3, assets: 2 },
		}),
	).toMatchObject([
		{
			processedRange: { from: "2026-09-15", to: "2026-09-16" },
			maintenanceRange: { from: "2024-07-01", to: "2026-09-16" },
			counts: { noticesProcessed: 15, attachmentsReused: 7 },
		},
		{ counts: { notices: 3, assets: 2 } },
	]);
});
