// @vitest-environment node

import type { V1CronJob, V1Job } from "@kubernetes/client-node";
import { describe, expect, it, vi } from "vitest";
import {
	createNoticePipelineJobService,
	KubernetesNoticePipelineJobStore,
	NoticePipelineConflictError,
	parseNoticePipelineSummary,
} from "../src/server/notice-pipeline-jobs";
import type { NoticePipelineJob } from "../src/shared/ops-contract";

const createdAt = new Date("2026-08-23T10:00:00.000Z");

describe("notice pipeline Kubernetes jobs", () => {
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
		const store = new KubernetesNoticePipelineJobStore(
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
		const store = new KubernetesNoticePipelineJobStore("campus-agent", batch as never, {} as never);

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
		const service = createNoticePipelineJobService(store);

		await expect(
			service.create({ noticeId: 354516, operation: "notice-classify-one" }),
		).rejects.toEqual(expect.any(NoticePipelineConflictError));
		expect(store.create).not.toHaveBeenCalled();
	});

	it("extracts only bounded scalar fields from the final structured log line", () => {
		expect(
			parseNoticePipelineSummary(
				[
					"plain progress line",
					JSON.stringify({ summary: { classified: 4, nested: { hidden: true }, skipped: 8 } }),
				].join("\n"),
			),
		).toEqual({ classified: 4, skipped: 8 });
		expect(parseNoticePipelineSummary("unstructured output")).toBeNull();
		expect(
			parseNoticePipelineSummary(JSON.stringify({ processed: 4, status: "running" })),
		).toBeNull();
	});
});

function collectionTemplate(): V1CronJob {
	return {
		metadata: { name: "notice-backfill" },
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
		metadata: { name },
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

function job(overrides: Partial<NoticePipelineJob> = {}): NoticePipelineJob {
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
