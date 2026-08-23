import {
	BatchV1Api,
	CoreV1Api,
	KubeConfig,
	type V1Container,
	type V1CronJob,
	type V1Job,
} from "@kubernetes/client-node";
import type {
	NoticePipelineJob,
	NoticePipelineJobCreate,
	NoticePipelineOperation,
} from "../shared/ops-contract.ts";

const MANAGED_BY_LABEL = "campus-agent.muc.wiki/managed-by";
const OPERATION_LABEL = "campus-agent.muc.wiki/notice-operation";
const FAMILY_LABEL = "campus-agent.muc.wiki/notice-operation-family";
const MANAGED_BY_VALUE = "ops-web";

type OperationFamily = "collection" | "classification" | "publication";

interface OperationDefinition {
	container: string;
	family: OperationFamily;
	template: string;
}

const OPERATIONS: Record<NoticePipelineOperation, OperationDefinition> = {
	"notice-sync": { container: "collection", family: "collection", template: "notice-sync" },
	"notice-backfill": { container: "collection", family: "collection", template: "notice-backfill" },
	"notice-classify-missing": {
		container: "classifier",
		family: "classification",
		template: "notice-classifier",
	},
	"notice-classify-one": {
		container: "classifier",
		family: "classification",
		template: "notice-classifier",
	},
	"notice-publish-all": {
		container: "publisher",
		family: "publication",
		template: "notice-publisher",
	},
	"notice-publish-one": {
		container: "publisher",
		family: "publication",
		template: "notice-publisher",
	},
};

export class NoticePipelineUnavailableError extends Error {
	constructor(message = "Kubernetes 通知任务接口暂不可用。", options?: ErrorOptions) {
		super(message, options);
		this.name = "NoticePipelineUnavailableError";
	}
}

export class NoticePipelineConflictError extends Error {
	readonly runningJobName: string;

	constructor(runningJobName: string) {
		super(`同类通知任务正在运行：${runningJobName}`);
		this.name = "NoticePipelineConflictError";
		this.runningJobName = runningJobName;
	}
}

export class NoticePipelineJobNotFoundError extends Error {
	constructor() {
		super("通知任务不存在。");
		this.name = "NoticePipelineJobNotFoundError";
	}
}

export interface NoticePipelineJobStore {
	create(input: NoticePipelineJobCreate): Promise<NoticePipelineJob>;
	get(jobName: string): Promise<NoticePipelineJob | null>;
	list(): Promise<NoticePipelineJob[]>;
}

export interface NoticePipelineJobService extends NoticePipelineJobStore {}

export function createNoticePipelineJobService(
	store: NoticePipelineJobStore,
): NoticePipelineJobService {
	return {
		async create(input) {
			const family = OPERATIONS[input.operation].family;
			const running = (await store.list()).find(
				(job) => OPERATIONS[job.operation].family === family && isActive(job.status),
			);
			if (running) {
				throw new NoticePipelineConflictError(running.jobName);
			}
			return store.create(input);
		},
		get: (jobName) => store.get(jobName),
		list: () => store.list(),
	};
}

export function createKubernetesNoticePipelineJobStore(namespace: string): NoticePipelineJobStore {
	try {
		const config = new KubeConfig();
		config.loadFromCluster();
		return new KubernetesNoticePipelineJobStore(
			namespace,
			config.makeApiClient(BatchV1Api),
			config.makeApiClient(CoreV1Api),
		);
	} catch (error) {
		return unavailableStore(error);
	}
}

type BatchClient = Pick<
	InstanceType<typeof BatchV1Api>,
	"createNamespacedJob" | "listNamespacedJob" | "readNamespacedCronJob" | "readNamespacedJob"
>;
type CoreClient = Pick<
	InstanceType<typeof CoreV1Api>,
	"listNamespacedPod" | "readNamespacedPodLog"
>;

export class KubernetesNoticePipelineJobStore implements NoticePipelineJobStore {
	private readonly namespace: string;
	private readonly batch: BatchClient;
	private readonly core: CoreClient;

	constructor(namespace: string, batch: BatchClient, core: CoreClient) {
		this.namespace = namespace;
		this.batch = batch;
		this.core = core;
	}

	async create(input: NoticePipelineJobCreate): Promise<NoticePipelineJob> {
		try {
			const definition = OPERATIONS[input.operation];
			const template = await this.batch.readNamespacedCronJob({
				name: definition.template,
				namespace: this.namespace,
			});
			const created = await this.batch.createNamespacedJob({
				body: buildJob(template, input, definition),
				namespace: this.namespace,
			});
			return await this.toJob(created);
		} catch (error) {
			throw mapKubernetesError(error);
		}
	}

	async get(jobName: string): Promise<NoticePipelineJob | null> {
		try {
			const job = await this.batch.readNamespacedJob({ name: jobName, namespace: this.namespace });
			if (job.metadata?.labels?.[MANAGED_BY_LABEL] !== MANAGED_BY_VALUE) {
				return null;
			}
			return await this.toJob(job);
		} catch (error) {
			if (kubernetesStatus(error) === 404) {
				return null;
			}
			throw mapKubernetesError(error);
		}
	}

	async list(): Promise<NoticePipelineJob[]> {
		try {
			const result = await this.batch.listNamespacedJob({
				labelSelector: `${MANAGED_BY_LABEL}=${MANAGED_BY_VALUE}`,
				limit: 50,
				namespace: this.namespace,
			});
			const jobs = await Promise.all(result.items.map((job) => this.toJob(job)));
			return jobs.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
		} catch (error) {
			throw mapKubernetesError(error);
		}
	}

	private async toJob(job: V1Job): Promise<NoticePipelineJob> {
		const jobName = job.metadata?.name;
		const operation = job.metadata?.labels?.[OPERATION_LABEL] as
			| NoticePipelineOperation
			| undefined;
		const createdAt = iso(job.metadata?.creationTimestamp);
		if (!(jobName && operation && operation in OPERATIONS && createdAt)) {
			throw new NoticePipelineUnavailableError("Kubernetes 返回了无效的通知任务。");
		}
		const status = jobStatus(job);
		const condition = job.status?.conditions?.find((entry) => entry.status === "True");
		return {
			completedAt: iso(job.status?.completionTime),
			createdAt,
			error:
				status === "failed"
					? bounded(condition?.message ?? condition?.reason ?? "任务执行失败。")
					: null,
			jobName,
			operation,
			startedAt: iso(job.status?.startTime),
			status,
			summary: status === "succeeded" ? await this.readSummary(jobName) : null,
		};
	}

	private async readSummary(jobName: string): Promise<NoticePipelineJob["summary"]> {
		const pods = await this.core.listNamespacedPod({
			labelSelector: `job-name=${jobName}`,
			limit: 1,
			namespace: this.namespace,
		});
		const pod = pods.items[0];
		const podName = pod?.metadata?.name;
		const container = pod?.spec?.containers[0]?.name;
		if (!(podName && container)) {
			return null;
		}
		const logs = await this.core.readNamespacedPodLog({
			container,
			limitBytes: 32_768,
			name: podName,
			namespace: this.namespace,
			tailLines: 40,
		});
		return parseNoticePipelineSummary(logs);
	}
}

function buildJob(
	template: V1CronJob,
	input: NoticePipelineJobCreate,
	definition: OperationDefinition,
): V1Job {
	const spec = structuredClone(template.spec?.jobTemplate.spec);
	if (!spec?.template.spec) {
		throw new NoticePipelineUnavailableError("通知任务模板不完整。");
	}
	const labels = {
		...(spec.template.metadata?.labels ?? {}),
		[FAMILY_LABEL]: definition.family,
		[MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
		[OPERATION_LABEL]: input.operation,
	};
	const container = spec.template.spec.containers.find(
		(entry) => entry.name === definition.container,
	);
	if (!container) {
		throw new NoticePipelineUnavailableError("通知任务模板容器不完整。");
	}
	applyOperation(container, input);
	return {
		apiVersion: "batch/v1",
		kind: "Job",
		metadata: { generateName: `${input.operation}-`, labels },
		spec: {
			...spec,
			template: { ...spec.template, metadata: { ...(spec.template.metadata ?? {}), labels } },
		},
	};
}

function applyOperation(container: V1Container, input: NoticePipelineJobCreate): void {
	if (input.operation === "notice-backfill") {
		container.env = [
			...(container.env ?? []).filter(
				(entry) => entry.name !== "INTERNAL_PORTAL_NOTICE_START_DATE",
			),
			{ name: "INTERNAL_PORTAL_NOTICE_START_DATE", value: input.startDate },
		];
	} else if (input.operation === "notice-classify-one") {
		container.args = ["--notice-id", String(input.noticeId)];
	} else if (input.operation === "notice-publish-one") {
		container.args = ["publish", "--notice-id", String(input.noticeId)];
	}
}

function jobStatus(job: V1Job): NoticePipelineJob["status"] {
	if (job.status?.conditions?.some((entry) => entry.type === "Failed" && entry.status === "True")) {
		return "failed";
	}
	if (
		job.status?.conditions?.some((entry) => entry.type === "Complete" && entry.status === "True")
	) {
		return "succeeded";
	}
	return job.status?.active || job.status?.startTime ? "running" : "pending";
}

export function parseNoticePipelineSummary(logs: string): NoticePipelineJob["summary"] {
	for (const line of logs.trim().split("\n").reverse()) {
		try {
			const parsed = JSON.parse(line) as unknown;
			if (
				!parsed ||
				typeof parsed !== "object" ||
				Array.isArray(parsed) ||
				!("summary" in parsed)
			) {
				continue;
			}
			const source = (parsed as { summary?: unknown }).summary;
			if (!source || typeof source !== "object" || Array.isArray(source)) {
				continue;
			}
			const entries = Object.entries(source).filter(
				([, value]) =>
					(typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ||
					typeof value === "boolean" ||
					(typeof value === "string" && value.length <= 200),
			);
			return entries.length > 0 ? Object.fromEntries(entries.slice(0, 20)) : null;
		} catch {
			// Ignore non-JSON progress lines and continue looking for the summary.
		}
	}
	return null;
}

function iso(value: Date | string | undefined): string | null {
	if (!value) {
		return null;
	}
	return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function bounded(value: string): string {
	return value.slice(0, 500);
}
function isActive(status: NoticePipelineJob["status"]): boolean {
	return status === "pending" || status === "running";
}

function kubernetesStatus(error: unknown): number | null {
	if (!error || typeof error !== "object") {
		return null;
	}
	if ("code" in error && typeof error.code === "number") {
		return error.code;
	}
	if ("statusCode" in error && typeof error.statusCode === "number") {
		return error.statusCode;
	}
	return null;
}

function mapKubernetesError(error: unknown): NoticePipelineUnavailableError {
	return error instanceof NoticePipelineUnavailableError
		? error
		: new NoticePipelineUnavailableError(undefined, { cause: error });
}

function unavailableStore(cause: unknown): NoticePipelineJobStore {
	const fail = () => Promise.reject(new NoticePipelineUnavailableError(undefined, { cause }));
	return { create: fail, get: fail, list: fail };
}
