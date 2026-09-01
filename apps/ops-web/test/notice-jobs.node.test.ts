// @vitest-environment node

import type { V1CronJob, V1Job } from "@kubernetes/client-node";
import { describe, expect, it, vi } from "vitest";
import {
	createNoticeJobService,
	KubernetesNoticeJobStore,
	NoticeJobConflictError,
	parseNoticeJobDiagnostics,
	parseNoticeJobSummary,
} from "../src/server/notice-jobs";
import type { NoticeJob } from "../src/shared/ops-contract";

const createdAt = new Date("2026-08-23T10:00:00.000Z");

describe("notice Kubernetes jobs", () => {
	it("clones the fixed backfill template and only injects its start date", async () => {
		const createNamespacedJob = vi.fn(async ({ body }: { body: V1Job }) => ({
			...body,
			metadata: { ...body.metadata, creationTimestamp: createdAt, name: "notice-backfill-abc12" },
		}));
		const batch = {
			createNamespacedJob,
			listNamespacedJob: vi.fn(),
			readNamespacedCronJob: vi.fn(async () => collectionTemplate()),
			readNamespacedJob: vi.fn(),
		};
		const store = new KubernetesNoticeJobStore("campus-agent", batch as never, emptyCore());

		const result = await store.create({
			operation: "notice-backfill",
			startDate: "2026-08-01",
		});

		const request = createNamespacedJob.mock.calls[0]?.[0];
		expect((request as { namespace?: string } | undefined)?.namespace).toBe("campus-agent");
		expect(request?.body.metadata).toMatchObject({
			generateName: "notice-backfill-",
			labels: {
				"campus-agent.muc.wiki/managed-by": "ops-web",
				"campus-agent.muc.wiki/notice-operation": "notice-backfill",
			},
			ownerReferences: [
				{
					apiVersion: "batch/v1",
					blockOwnerDeletion: false,
					controller: false,
					kind: "CronJob",
					name: "notice-backfill",
					uid: "notice-backfill-template-uid",
				},
			],
		});
		expect(request?.body.spec).toMatchObject({
			backoffLimit: 0,
			ttlSecondsAfterFinished: 86_400,
		});
		expect(request?.body.spec?.template.spec?.containers[0]).toMatchObject({
			args: ["notice-backfill"],
			env: expect.arrayContaining([
				{ name: "EXISTING", value: "preserved" },
				{ name: "INTERNAL_PORTAL_NOTICE_START_DATE", value: "2026-08-01" },
			]),
			image: "collector:test",
		});
		expect(request?.body.metadata?.labels).not.toHaveProperty("campus-agent.muc.wiki/notice-id");
		expect(request?.body.spec?.template.metadata?.labels).not.toHaveProperty(
			"campus-agent.muc.wiki/notice-id",
		);
		expect(result.noticeId).toBeNull();
	});

	it("rejects a CronJob template without an owner UID", async () => {
		const template = collectionTemplate();
		delete template.metadata?.uid;
		const batch = {
			createNamespacedJob: vi.fn(),
			listNamespacedJob: vi.fn(),
			readNamespacedCronJob: vi.fn(async () => template),
			readNamespacedJob: vi.fn(),
		};
		const store = new KubernetesNoticeJobStore("campus-agent", batch as never, emptyCore());

		await expect(
			store.create({ operation: "notice-backfill", startDate: "2026-08-01" }),
		).rejects.toThrow("通知任务模板不完整");
		expect(batch.createNamespacedJob).not.toHaveBeenCalled();
	});

	it("maps one-notice operations to the existing classifier and publisher arguments", async () => {
		const created: V1Job[] = [];
		const batch = {
			createNamespacedJob: vi.fn(async ({ body }: { body: V1Job }) => {
				created.push(body);
				return {
					...body,
					metadata: { ...body.metadata, creationTimestamp: createdAt, name: "job-name" },
				};
			}),
			listNamespacedJob: vi.fn(),
			readNamespacedCronJob: vi.fn(async ({ name }: { name: string }) => jobTemplate(name)),
			readNamespacedJob: vi.fn(),
		};
		const store = new KubernetesNoticeJobStore("campus-agent", batch as never, emptyCore());

		const classified = await store.create({
			noticeId: 354516,
			operation: "notice-classify-one",
		});
		const published = await store.create({ noticeId: 354516, operation: "notice-publish-one" });
		const republished = await store.create({ noticeId: 354516, operation: "notice-republish-one" });

		expect(created[0]?.spec?.template.spec?.containers[0]?.args).toEqual([
			"--concurrency",
			"8",
			"--notice-id",
			"354516",
		]);
		expect(created[1]?.spec?.template.spec?.containers[0]?.args).toEqual([
			"publish",
			"--notice-id",
			"354516",
		]);
		expect(created[2]?.spec?.template.spec?.containers[0]?.args).toEqual([
			"republish",
			"--notice-id",
			"354516",
		]);
		for (const job of created) {
			expect(job.metadata?.labels).toMatchObject({
				"campus-agent.muc.wiki/notice-id": "354516",
			});
			expect(job.spec?.template.metadata?.labels).toMatchObject({
				"campus-agent.muc.wiki/notice-id": "354516",
			});
		}
		expect(classified.noticeId).toBe(354516);
		expect(published.noticeId).toBe(354516);
		expect(republished.noticeId).toBe(354516);
	});

	it("reads persisted notice ownership and keeps legacy one-notice jobs unassociated", async () => {
		const batch = {
			createNamespacedJob: vi.fn(),
			listNamespacedJob: vi.fn(async () => ({
				items: [
					managedJob({
						name: "notice-publish-one-owned",
						noticeId: "354516",
						operation: "notice-publish-one",
					}),
					managedJob({
						name: "notice-classify-one-legacy",
						operation: "notice-classify-one",
					}),
					managedJob({ name: "notice-sync-batch", operation: "notice-sync" }),
				],
			})),
			readNamespacedCronJob: vi.fn(),
			readNamespacedJob: vi.fn(async () =>
				managedJob({
					name: "notice-classify-one-legacy",
					operation: "notice-classify-one",
				}),
			),
		};
		const store = new KubernetesNoticeJobStore("campus-agent", batch as never, emptyCore());

		await expect(store.list()).resolves.toEqual([
			expect.objectContaining({ jobName: "notice-publish-one-owned", noticeId: 354516 }),
			expect.objectContaining({ jobName: "notice-classify-one-legacy", noticeId: null }),
			expect.objectContaining({ jobName: "notice-sync-batch", noticeId: null }),
		]);
		await expect(store.get("notice-classify-one-legacy")).resolves.toEqual(
			expect.objectContaining({ noticeId: null }),
		);
	});

	it("rejects a second active job in the same operation family", async () => {
		const running = job({
			jobName: "notice-classify-missing-running",
			operation: "notice-classify-missing",
			status: "running",
		});
		const store = { create: vi.fn(), get: vi.fn(), list: vi.fn(async () => [running]) };
		const service = createNoticeJobService(store);

		await expect(
			service.create({ noticeId: 354516, operation: "notice-classify-one" }),
		).rejects.toEqual(expect.any(NoticeJobConflictError));
		expect(store.create).not.toHaveBeenCalled();
	});

	it("does not treat a failed job as active", async () => {
		const failed = job({
			jobName: "notice-classify-missing-failed",
			operation: "notice-classify-missing",
			status: "failed",
		});
		const created = job({ operation: "notice-classify-one" });
		const store = {
			create: vi.fn(async () => created),
			get: vi.fn(),
			list: vi.fn(async () => [failed]),
		};
		const service = createNoticeJobService(store);

		await expect(
			service.create({ noticeId: 354516, operation: "notice-classify-one" }),
		).resolves.toEqual(created);
		expect(store.create).toHaveBeenCalledOnce();
	});

	it("extracts only bounded scalar fields from the final structured log line", () => {
		expect(
			parseNoticeJobSummary(
				[
					"plain progress line",
					JSON.stringify({ summary: { classified: 4, nested: { hidden: true }, skipped: 8 } }),
				].join("\n"),
			),
		).toEqual({ classified: 4, skipped: 8 });
		expect(
			parseNoticeJobSummary(JSON.stringify({ summary: { unchanged: 2, updated: 3 } })),
		).toEqual({ unchanged: 2, updated: 3 });
		expect(parseNoticeJobSummary(JSON.stringify({ summary: { attachmentsMissing: 1 } }))).toEqual({
			attachmentsMissing: 1,
		});
		expect(parseNoticeJobSummary("unstructured output")).toBeNull();
		expect(parseNoticeJobSummary(JSON.stringify({ processed: 4, status: "running" }))).toBeNull();
	});

	it("does not treat a structured missing-attachment record as an application error", () => {
		expect(
			parseNoticeJobDiagnostics(
				JSON.stringify({
					noticeResource: {
						disposition: "missing",
						httpStatus: 404,
						noticeId: 247943,
						resourceKind: "attachments",
						resourceOrdinal: 0,
					},
					status: "running",
				}),
			),
		).toEqual({
			error: null,
			maintenanceRange: null,
			processedRange: null,
			progress: null,
			summary: null,
		});
	});

	it("does not report a structured summary without scalar fields as an application error", () => {
		expect(
			parseNoticeJobDiagnostics(
				JSON.stringify({ summary: { failures: [{ noticeId: 1, reason: "failed" }] } }),
			),
		).toEqual({
			error: null,
			maintenanceRange: null,
			processedRange: null,
			progress: null,
			summary: null,
		});
	});

	it("reads failed pod output and separates application and controller errors", async () => {
		const batch = {
			createNamespacedJob: vi.fn(),
			listNamespacedJob: vi.fn(),
			readNamespacedCronJob: vi.fn(),
			readNamespacedJob: vi.fn(async () => ({
				metadata: {
					creationTimestamp: createdAt,
					labels: {
						"campus-agent.muc.wiki/managed-by": "ops-web",
						"campus-agent.muc.wiki/notice-operation": "notice-classify-missing",
					},
					name: "notice-classify-missing-failed",
				},
				status: {
					conditions: [
						{
							message: "Job has reached the specified backoff limit",
							reason: "BackoffLimitExceeded",
							status: "True",
							type: "Failed",
						},
					],
				},
			})),
		};
		const core = {
			listNamespacedPod: vi.fn(async () => ({
				items: [
					{
						metadata: {
							creationTimestamp: new Date("2026-08-26T02:30:00.000Z"),
							name: "failed-pod-old",
						},
						spec: { containers: [{ name: "classifier" }] },
						status: {
							containerStatuses: [{ name: "classifier", state: { terminated: { exitCode: 1 } } }],
						},
					},
					{
						metadata: {
							creationTimestamp: new Date("2026-08-26T02:31:00.000Z"),
							name: "failed-pod-latest",
						},
						spec: { containers: [{ name: "classifier" }] },
						status: {
							containerStatuses: [{ name: "classifier", state: { terminated: { exitCode: 1 } } }],
						},
					},
				],
			})),
			readNamespacedPodLog: vi.fn(async ({ name }: { name: string }) =>
				[
					JSON.stringify({
						progress: { phase: "processing", processed: 1, total: 4 },
						status: "running",
					}),
					`Error: ${name} model provider returned HTTP 502: upstream response body`,
					"    at requestClassification (model.ts:1:1)",
				].join("\n"),
			),
		};
		const store = new KubernetesNoticeJobStore("campus-agent", batch as never, core as never);

		await expect(store.get("notice-classify-missing-failed")).resolves.toMatchObject({
			controllerError: "BackoffLimitExceeded: Job has reached the specified backoff limit",
			error: expect.stringContaining(
				"failed-pod-latest model provider returned HTTP 502: upstream response body",
			),
			progress: { phase: "processing", processed: 1, total: 4 },
		});
		expect(core.readNamespacedPodLog).toHaveBeenCalledWith(
			expect.objectContaining({ name: "failed-pod-latest" }),
		);
	});

	it("keeps a running job readable while its container is still waiting", async () => {
		const batch = {
			createNamespacedJob: vi.fn(),
			listNamespacedJob: vi.fn(),
			readNamespacedCronJob: vi.fn(),
			readNamespacedJob: vi.fn(async () => ({
				metadata: {
					creationTimestamp: createdAt,
					labels: {
						"campus-agent.muc.wiki/managed-by": "ops-web",
						"campus-agent.muc.wiki/notice-operation": "notice-classify-missing",
					},
					name: "notice-classify-missing-running",
				},
				status: { active: 1, startTime: createdAt },
			})),
		};
		const core = {
			listNamespacedPod: vi.fn(async () => ({
				items: [
					{
						metadata: { creationTimestamp: createdAt, name: "waiting-pod" },
						spec: { containers: [{ name: "classifier" }] },
						status: {
							containerStatuses: [
								{
									name: "classifier",
									state: { waiting: { reason: "ContainerCreating" } },
								},
							],
						},
					},
				],
			})),
			readNamespacedPodLog: vi.fn(),
		};
		const store = new KubernetesNoticeJobStore("campus-agent", batch as never, core as never);

		await expect(store.get("notice-classify-missing-running")).resolves.toMatchObject({
			error: null,
			progress: null,
			status: "running",
		});
		expect(core.readNamespacedPodLog).not.toHaveBeenCalled();
	});

	it("parses the latest processing and maintenance ranges, progress, summary, and raw output", () => {
		expect(
			parseNoticeJobDiagnostics(
				[
					JSON.stringify({
						progress: { phase: "scanning", processed: 2, total: 10 },
						processedRange: { from: "2026-08-01", to: "2026-08-10" },
						status: "running",
					}),
					JSON.stringify({
						maintenanceRange: { from: "2025-12-01", to: "2026-08-26" },
						progress: { phase: "writing", processed: 3, total: 4 },
						processedRange: { from: "2026-08-01", to: "2026-08-26" },
						status: "running",
					}),
					JSON.stringify({ summary: { noticesProcessed: 4 } }),
					"raw application line",
				].join("\n"),
			),
		).toEqual({
			error: "raw application line",
			maintenanceRange: { from: "2025-12-01", to: "2026-08-26" },
			processedRange: { from: "2026-08-01", to: "2026-08-26" },
			progress: { phase: "writing", processed: 3, total: 4 },
			summary: { noticesProcessed: 4 },
		});
	});

	it("preserves multiple explicit application errors in log order", () => {
		expect(
			parseNoticeJobDiagnostics(
				[
					JSON.stringify({ error: "first resource failure", status: "failed" }),
					JSON.stringify({ error: "second resource failure\ncaused by timeout", status: "failed" }),
				].join("\n"),
			).error,
		).toBe("first resource failure\nsecond resource failure\ncaused by timeout");
	});
});

function collectionTemplate(): V1CronJob {
	return {
		apiVersion: "batch/v1",
		kind: "CronJob",
		metadata: { name: "notice-backfill", uid: "notice-backfill-template-uid" },
		spec: {
			jobTemplate: {
				spec: {
					backoffLimit: 0,
					template: {
						metadata: { labels: { "app.kubernetes.io/name": "internal-portal-collection" } },
						spec: {
							containers: [
								{
									args: ["notice-backfill"],
									env: [{ name: "EXISTING", value: "preserved" }],
									image: "collector:test",
									name: "collection",
								},
							],
							restartPolicy: "Never",
						},
					},
				},
			},
			schedule: "0 0 1 1 *",
		},
	};
}

function jobTemplate(name: string): V1CronJob {
	const classifier = name === "notice-classifier";
	return {
		apiVersion: "batch/v1",
		kind: "CronJob",
		metadata: { name, uid: `${name}-template-uid` },
		spec: {
			jobTemplate: {
				spec: {
					template: {
						spec: {
							containers: [
								{
									args: classifier ? ["--concurrency", "8"] : ["publish"],
									image: "job:test",
									name: classifier ? "classifier" : "publisher",
								},
							],
							restartPolicy: "Never",
						},
					},
				},
			},
			schedule: "0 0 1 1 *",
		},
	};
}

function job(overrides: Partial<NoticeJob> = {}): NoticeJob {
	return {
		completedAt: null,
		createdAt: createdAt.toISOString(),
		controllerError: null,
		error: null,
		jobName: "notice-sync-test",
		maintenanceRange: null,
		noticeId: null,
		operation: "notice-sync",
		processedRange: null,
		progress: null,
		startedAt: null,
		status: "pending",
		summary: null,
		...overrides,
	};
}

function emptyCore() {
	return {
		listNamespacedPod: vi.fn(async () => ({ items: [] })),
		readNamespacedPodLog: vi.fn(),
	} as never;
}

function managedJob(input: {
	name: string;
	noticeId?: string;
	operation: NoticeJob["operation"];
}): V1Job {
	return {
		metadata: {
			creationTimestamp: createdAt,
			labels: {
				"campus-agent.muc.wiki/managed-by": "ops-web",
				"campus-agent.muc.wiki/notice-operation": input.operation,
				...(input.noticeId ? { "campus-agent.muc.wiki/notice-id": input.noticeId } : {}),
			},
			name: input.name,
		},
	};
}
