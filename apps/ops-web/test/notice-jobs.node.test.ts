// @vitest-environment node

import type { V1CronJob, V1Job } from "@kubernetes/client-node";
import { describe, expect, it, vi } from "vitest";
import {
	createNoticeJobService,
	KubernetesNoticeJobStore,
	NoticeJobConflictError,
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
		const store = new KubernetesNoticeJobStore(
			"campus-agent",
			batch as never,
			{
				listNamespacedPod: vi.fn(),
				readNamespacedPodLog: vi.fn(),
			} as never,
		);

		await store.create({ operation: "notice-backfill", startDate: "2026-08-01" });

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
		const store = new KubernetesNoticeJobStore("campus-agent", batch as never, {} as never);

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
		const store = new KubernetesNoticeJobStore("campus-agent", batch as never, {} as never);

		await store.create({ noticeId: 354516, operation: "notice-classify-one" });
		await store.create({ noticeId: 354516, operation: "notice-publish-one" });

		expect(created[0]?.spec?.template.spec?.containers[0]?.args).toEqual(["--notice-id", "354516"]);
		expect(created[1]?.spec?.template.spec?.containers[0]?.args).toEqual([
			"publish",
			"--notice-id",
			"354516",
		]);
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
		expect(parseNoticeJobSummary("unstructured output")).toBeNull();
		expect(parseNoticeJobSummary(JSON.stringify({ processed: 4, status: "running" }))).toBeNull();
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
									...(classifier ? {} : { args: ["publish"] }),
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
		error: null,
		jobName: "notice-sync-test",
		operation: "notice-sync",
		startedAt: null,
		status: "pending",
		summary: null,
		...overrides,
	};
}
