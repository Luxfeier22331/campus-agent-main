// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
	NoticePipelineConflictError,
	NoticePipelineUnavailableError,
} from "../src/server/notice-pipeline-jobs";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission";
import type { NoticePipelineJob } from "../src/shared/ops-contract";
import { createTestOpsApp } from "./helpers/ops-app";

const fixture: NoticePipelineJob = {
	completedAt: null,
	createdAt: "2026-08-23T10:00:00.000Z",
	error: null,
	jobName: "notice-backfill-abc12",
	operation: "notice-backfill",
	startedAt: null,
	status: "pending",
	summary: null,
};

describe("notice pipeline API", () => {
	it("accepts only the fixed operation payload and returns created jobs", async () => {
		const create = vi.fn(async () => fixture);
		const app = createTestOpsApp({
			admission: createAllowAllOpsAdmission(),
			noticePipelineJobService: { create, get: vi.fn(), list: vi.fn(async () => []) },
		});

		const response = await app.request("/api/ops/notice-pipeline/jobs", {
			body: JSON.stringify({ operation: "notice-backfill", startDate: "2026-08-01" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		const arbitrary = await app.request("/api/ops/notice-pipeline/jobs", {
			body: JSON.stringify({ command: ["rm", "-rf"], operation: "notice-sync" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		});

		expect(response.status).toBe(201);
		await expect(response.json()).resolves.toEqual({ job: fixture });
		expect(create).toHaveBeenCalledWith({ operation: "notice-backfill", startDate: "2026-08-01" });
		expect(arbitrary.status).toBe(400);
	});

	it("maps running-family conflicts and Kubernetes availability failures", async () => {
		const conflict = createTestOpsApp({
			admission: createAllowAllOpsAdmission(),
			noticePipelineJobService: {
				create: vi.fn(async () => {
					throw new NoticePipelineConflictError("notice-sync-running");
				}),
				get: vi.fn(),
				list: vi.fn(async () => []),
			},
		});
		const unavailable = createTestOpsApp({
			admission: createAllowAllOpsAdmission(),
			noticePipelineJobService: {
				create: vi.fn(),
				get: vi.fn(),
				list: vi.fn(async () => {
					throw new NoticePipelineUnavailableError();
				}),
			},
		});

		const conflictResponse = await conflict.request("/api/ops/notice-pipeline/jobs", {
			body: JSON.stringify({ operation: "notice-sync" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		const unavailableResponse = await unavailable.request("/api/ops/notice-pipeline/jobs");

		expect(conflictResponse.status).toBe(409);
		await expect(conflictResponse.json()).resolves.toMatchObject({
			error: { code: "OPS_NOTICE_JOB_CONFLICT", runningJobName: "notice-sync-running" },
		});
		expect(unavailableResponse.status).toBe(503);
	});

	it("lists managed jobs and returns 404 for an unknown managed job", async () => {
		const app = createTestOpsApp({
			admission: createAllowAllOpsAdmission(),
			noticePipelineJobService: {
				create: vi.fn(),
				get: vi.fn(async () => null),
				list: vi.fn(async () => [fixture]),
			},
		});

		await expect((await app.request("/api/ops/notice-pipeline/jobs")).json()).resolves.toEqual({
			jobs: [fixture],
		});
		const missing = await app.request("/api/ops/notice-pipeline/jobs/missing-job");
		expect(missing.status).toBe(404);
	});
});
