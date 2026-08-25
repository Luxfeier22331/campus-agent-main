// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { NoticeJobConflictError, NoticeJobUnavailableError } from "../src/server/notice-jobs";
import { createAllowAllOpsAdmission } from "../src/server/ops-admission";
import type { NoticeJob, NoticeSummary } from "../src/shared/ops-contract";
import { createTestOpsApp } from "./helpers/ops-app";

const fixture: NoticeJob = {
	completedAt: null,
	createdAt: "2026-08-23T10:00:00.000Z",
	error: null,
	jobName: "notice-backfill-abc12",
	operation: "notice-backfill",
	startedAt: null,
	status: "pending",
	summary: null,
};

describe("notice API", () => {
	it("lists safe notice metadata and updates the authoritative category", async () => {
		const list = vi.fn(async () => ({
			items: [noticeFixture],
			page: 1,
			totalItems: 1,
			totalPages: 1,
		}));
		const updateCategory = vi.fn(async () => ({
			...noticeFixture,
			category: "campus_news" as const,
			state: "published" as const,
		}));
		const app = createTestOpsApp({
			admission: createAllowAllOpsAdmission(),
			noticeStore: { get: vi.fn(async () => noticeFixture), list, updateCategory },
		});

		const response = await app.request(
			"/api/ops/notices?state=needs_classification&category=unclassified&page=1&q=354516",
		);
		expect(response.status).toBe(200);
		expect(list).toHaveBeenCalledWith({
			category: "unclassified",
			page: 1,
			q: "354516",
			state: "needs_classification",
		});

		const update = await app.request("/api/ops/notices/354516/category", {
			body: JSON.stringify({ category: "campus_news" }),
			headers: { "content-type": "application/json" },
			method: "PUT",
		});
		expect(update.status).toBe(200);
		expect(updateCategory).toHaveBeenCalledWith(354516, "campus_news");
	});

	it("accepts only the fixed operation payload and returns created jobs", async () => {
		const create = vi.fn(async () => fixture);
		const app = createTestOpsApp({
			admission: createAllowAllOpsAdmission(),
			noticeJobService: { create, get: vi.fn(), list: vi.fn(async () => []) },
		});

		const response = await app.request("/api/ops/notices/jobs", {
			body: JSON.stringify({ operation: "notice-backfill", startDate: "2026-08-01" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		const arbitrary = await app.request("/api/ops/notices/jobs", {
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
			noticeJobService: {
				create: vi.fn(async () => {
					throw new NoticeJobConflictError("notice-sync-running");
				}),
				get: vi.fn(),
				list: vi.fn(async () => []),
			},
		});
		const unavailable = createTestOpsApp({
			admission: createAllowAllOpsAdmission(),
			noticeJobService: {
				create: vi.fn(),
				get: vi.fn(),
				list: vi.fn(async () => {
					throw new NoticeJobUnavailableError();
				}),
			},
		});

		const conflictResponse = await conflict.request("/api/ops/notices/jobs", {
			body: JSON.stringify({ operation: "notice-sync" }),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		const unavailableResponse = await unavailable.request("/api/ops/notices/jobs");

		expect(conflictResponse.status).toBe(409);
		await expect(conflictResponse.json()).resolves.toMatchObject({
			error: { code: "OPS_NOTICE_JOB_CONFLICT", runningJobName: "notice-sync-running" },
		});
		expect(unavailableResponse.status).toBe(503);
	});

	it("lists managed jobs and returns 404 for an unknown managed job", async () => {
		const app = createTestOpsApp({
			admission: createAllowAllOpsAdmission(),
			noticeJobService: {
				create: vi.fn(),
				get: vi.fn(async () => null),
				list: vi.fn(async () => [fixture]),
			},
		});

		await expect((await app.request("/api/ops/notices/jobs")).json()).resolves.toEqual({
			jobs: [fixture],
		});
		const missing = await app.request("/api/ops/notices/jobs/missing-job");
		expect(missing.status).toBe(404);
	});
});

const noticeFixture: NoticeSummary = {
	category: null,
	externalUrl: null,
	isExternal: false,
	noticeId: 354516,
	noticeType: { id: 5, name: "办公通知" },
	organization: null,
	releasedAt: "2026-08-23T10:00:00.000Z",
	state: "needs_classification",
	title: "测试通知",
};
