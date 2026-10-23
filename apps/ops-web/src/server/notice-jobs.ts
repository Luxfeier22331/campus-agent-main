import {
	BatchV1Api,
	CoreV1Api,
	KubeConfig,
	type V1Container,
	type V1CronJob,
	type V1Job,
	type V1Pod,
} from "@kubernetes/client-node";
import {
	type NoticeJob,
	type NoticeJobCreate,
	type NoticeJobOperation,
	type NoticeJobProgress,
	NoticeJobProgressSchema,
	type NoticeJobRange,
	NoticeJobRangeSchema,
	NoticeJobSummarySchema,
} from "../shared/ops-contract.ts";

const MANAGED_BY_LABEL = "campus-agent.muc.wiki/managed-by";
const OPERATION_LABEL = "campus-agent.muc.wiki/notice-operation";
const FAMILY_LABEL = "campus-agent.muc.wiki/notice-operation-family";
const NOTICE_ID_LABEL = "campus-agent.muc.wiki/notice-id";
const MANAGED_BY_VALUE = "ops-web";

function isNoticeJob(job: V1Job): boolean {
	const operation = job.metadata?.labels?.[OPERATION_LABEL];
	return Boolean(operation && Object.hasOwn(OPERATIONS, operation));
}

type OperationFamily = "collection" | "classification" | "publication";

interface OperationDefinition {
	container: string;
	family: OperationFamily;
	template: string;
}

const OPERATIONS: Record<NoticeJobOperation, OperationDefinition> = {
	"notice-sync": { container: "collection", family: "collection", template: "notice-sync" },
	"notice-rescan": { container: "collection", family: "collection", template: "notice-sync" },
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
	"notice-publish-pending": {
		container: "publisher",
		family: "publication",
		template: "notice-publisher",
	},
	"notice-publish-one": {
		container: "publisher",
		family: "publication",
		template: "notice-publisher",
	},
	"notice-republish-one": {
		container: "publisher",
		family: "publication",
		template: "notice-publisher",
	},
};

export class NoticeJobUnavailableError extends Error {
	constructor(message = "Kubernetes 通知任务接口暂不可用。", options?: ErrorOptions) {
		super(message, options);
		this.name = "NoticeJobUnavailableError";
	}
}

export class NoticeJobConflictError extends Error {
	readonly runningJobName: string;

	constructor(runningJobName: string) {
		super(`同类通知任务正在运行：${runningJobName}`);
		this.name = "NoticeJobConflictError";
		this.runningJobName = runningJobName;
	}
}

export class NoticeJobNotFoundError extends Error {
	constructor() {
		super("通知任务不存在。");
		this.name = "NoticeJobNotFoundError";
	}
}

export interface NoticeJobStore {
	findActive?(family: OperationFamily): Promise<string | null>;
	create(input: NoticeJobCreate): Promise<NoticeJob>;
	get(jobName: string): Promise<NoticeJob | null>;
	list(): Promise<NoticeJob[]>;
}

export interface NoticeJobService extends NoticeJobStore {}

export function createNoticeJobService(store: NoticeJobStore): NoticeJobService {
	return {
		async create(input) {
			const family = OPERATIONS[input.operation].family;
			const active = store.findActive ? await store.findActive(family) : null;
			if (active) {
				throw new NoticeJobConflictError(active);
			}
			const running = store.findActive
				? undefined
				: (await store.list()).find(
						(job) => OPERATIONS[job.operation].family === family && isActive(job.status),
					);
			if (running) {
				throw new NoticeJobConflictError(running.jobName);
			}
			return store.create(input);
		},
		get: (jobName) => store.get(jobName),
		list: () => store.list(),
	};
}

export function createKubernetesNoticeJobStore(namespace: string): NoticeJobStore {
	try {
		const config = new KubeConfig();
		config.loadFromCluster();
		return new KubernetesNoticeJobStore(
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

export class KubernetesNoticeJobStore implements NoticeJobStore {
	private readonly namespace: string;
	private readonly batch: BatchClient;
	private readonly core: CoreClient;

	constructor(namespace: string, batch: BatchClient, core: CoreClient) {
		this.namespace = namespace;
		this.batch = batch;
		this.core = core;
	}

	async create(input: NoticeJobCreate): Promise<NoticeJob> {
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

	async get(jobName: string): Promise<NoticeJob | null> {
		try {
			const job = await this.batch.readNamespacedJob({ name: jobName, namespace: this.namespace });
			if (!isNoticeJob(job)) {
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

	async list(): Promise<NoticeJob[]> {
		try {
			const selected = (await this.listMetadata())
				.sort((a, b) =>
					String(iso(b.metadata?.creationTimestamp)).localeCompare(
						String(iso(a.metadata?.creationTimestamp)),
					),
				)
				.slice(0, 50);
			const jobs = await Promise.all(selected.map((job) => this.toJob(job)));
			return jobs.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
		} catch (error) {
			throw mapKubernetesError(error);
		}
	}

	async findActive(family: OperationFamily): Promise<string | null> {
		try {
			const active = (await this.listMetadata()).find((job) => {
				const operation = job.metadata?.labels?.[OPERATION_LABEL] as NoticeJobOperation;
				return OPERATIONS[operation].family === family && isActive(jobStatus(job));
			});
			return active?.metadata?.name ?? null;
		} catch (error) {
			throw mapKubernetesError(error);
		}
	}

	private async listMetadata(): Promise<V1Job[]> {
		const jobs: V1Job[] = [];
		let continuation: string | undefined;
		do {
			const result = await this.batch.listNamespacedJob({
				namespace: this.namespace,
				labelSelector: `${OPERATION_LABEL} in (${Object.keys(OPERATIONS).join(",")})`,
				limit: 100,
				...(continuation ? { _continue: continuation } : {}),
			});
			jobs.push(...result.items.filter(isNoticeJob));
			continuation = result.metadata?._continue;
		} while (continuation);
		return jobs;
	}

	private async toJob(job: V1Job): Promise<NoticeJob> {
		const jobName = job.metadata?.name;
		const operation = job.metadata?.labels?.[OPERATION_LABEL] as NoticeJobOperation | undefined;
		const createdAt = iso(job.metadata?.creationTimestamp);
		if (!(jobName && operation && operation in OPERATIONS && createdAt)) {
			throw new NoticeJobUnavailableError("Kubernetes 返回了无效的通知任务。");
		}
		const noticeId = singleNoticeOperation(operation)
			? parseNoticeId(job.metadata?.labels?.[NOTICE_ID_LABEL])
			: null;
		const status = jobStatus(job);
		const failureCondition = job.status?.conditions?.find(
			(entry) => entry.type === "Failed" && entry.status === "True",
		);
		const diagnostics = await this.readDiagnostics(jobName, OPERATIONS[operation].container);
		return {
			completedAt: iso(job.status?.completionTime),
			createdAt,
			controllerError: status === "failed" ? controllerError(failureCondition) : null,
			error: status === "failed" ? diagnostics.error : null,
			jobName,
			maintenanceRange: diagnostics.maintenanceRange,
			noticeId,
			operation,
			trigger: job.metadata?.ownerReferences?.some(
				(owner) => owner.kind === "CronJob" && owner.controller === true,
			)
				? "scheduled"
				: "manual",
			processedRange: diagnostics.processedRange,
			progress: diagnostics.progress,
			startedAt: iso(job.status?.startTime),
			status,
			summary: diagnostics.summary,
		};
	}

	private async readDiagnostics(
		jobName: string,
		containerName: string,
	): Promise<NoticeJobDiagnostics> {
		const pods = await this.core.listNamespacedPod({
			labelSelector: `job-name=${jobName}`,
			namespace: this.namespace,
		});
		const pod = [...pods.items]
			.sort((left, right) => podCreationTime(right) - podCreationTime(left))
			.find((entry) => hasReadableContainerLog(entry, containerName));
		const podName = pod?.metadata?.name;
		if (!podName) {
			return emptyDiagnostics();
		}
		let logs: string;
		try {
			logs = await this.core.readNamespacedPodLog({
				container: containerName,
				name: podName,
				namespace: this.namespace,
			});
		} catch (error) {
			const status = kubernetesStatus(error);
			if (status === 400 || status === 404) {
				return emptyDiagnostics();
			}
			throw error;
		}
		return parseNoticeJobDiagnostics(logs);
	}
}

function buildJob(
	template: V1CronJob,
	input: NoticeJobCreate,
	definition: OperationDefinition,
): V1Job {
	const spec = structuredClone(template.spec?.jobTemplate.spec);
	const templateName = template.metadata?.name;
	const templateUid = template.metadata?.uid;
	if (!(spec?.template.spec && templateName && templateUid)) {
		throw new NoticeJobUnavailableError("通知任务模板不完整。");
	}
	const labels = {
		...(spec.template.metadata?.labels ?? {}),
		[FAMILY_LABEL]: definition.family,
		[MANAGED_BY_LABEL]: MANAGED_BY_VALUE,
		[OPERATION_LABEL]: input.operation,
		...("noticeId" in input ? { [NOTICE_ID_LABEL]: String(input.noticeId) } : {}),
	};
	const container = spec.template.spec.containers.find(
		(entry) => entry.name === definition.container,
	);
	if (!container) {
		throw new NoticeJobUnavailableError("通知任务模板容器不完整。");
	}
	applyOperation(container, input);
	return {
		apiVersion: "batch/v1",
		kind: "Job",
		metadata: {
			generateName: `${input.operation}-`,
			labels,
			ownerReferences: [
				{
					apiVersion: template.apiVersion ?? "batch/v1",
					blockOwnerDeletion: false,
					controller: false,
					kind: template.kind ?? "CronJob",
					name: templateName,
					uid: templateUid,
				},
			],
		},
		spec: {
			...spec,
			backoffLimit: 0,
			template: { ...spec.template, metadata: { ...(spec.template.metadata ?? {}), labels } },
			ttlSecondsAfterFinished: 86_400,
		},
	};
}

function applyOperation(container: V1Container, input: NoticeJobCreate): void {
	if (input.operation === "notice-rescan") {
		container.args = ["notice-rescan"];
		container.env = [
			...(container.env ?? []).filter(
				(entry) =>
					!["INTERNAL_PORTAL_NOTICE_FROM", "INTERNAL_PORTAL_NOTICE_TO"].includes(entry.name),
			),
			{ name: "INTERNAL_PORTAL_NOTICE_FROM", value: input.from },
			{ name: "INTERNAL_PORTAL_NOTICE_TO", value: input.to },
		];
	}
	if (input.operation === "notice-backfill") {
		container.env = [
			...(container.env ?? []).filter(
				(entry) => entry.name !== "INTERNAL_PORTAL_NOTICE_START_DATE",
			),
			{ name: "INTERNAL_PORTAL_NOTICE_START_DATE", value: input.startDate },
		];
	} else if (input.operation === "notice-classify-one") {
		container.args = [...(container.args ?? []), "--notice-id", String(input.noticeId)];
	} else if (input.operation === "notice-publish-one") {
		container.args = [...(container.args ?? []), "--notice-id", String(input.noticeId)];
	} else if (input.operation === "notice-republish-one") {
		container.args = ["republish", "--notice-id", String(input.noticeId)];
	}
}

function jobStatus(job: V1Job): NoticeJob["status"] {
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

export interface NoticeJobDiagnostics {
	error: string | null;
	maintenanceRange: NoticeJobRange | null;
	processedRange: NoticeJobRange | null;
	progress: NoticeJobProgress | null;
	summary: NoticeJob["summary"];
}

export function parseNoticeJobDiagnostics(logs: string): NoticeJobDiagnostics {
	let progress: NoticeJobProgress | null = null;
	let maintenanceRange: NoticeJobRange | null = null;
	let processedRange: NoticeJobRange | null = null;
	let summary: NoticeJob["summary"] = null;
	const errorLines: string[] = [];
	for (const line of logs.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(trimmed) as unknown;
		} catch {
			errorLines.push(line);
			continue;
		}
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			errorLines.push(line);
			continue;
		}
		const record = parsed as Record<string, unknown>;
		const progressValue = NoticeJobProgressSchema.safeParse(record.progress);
		if (progressValue.success) {
			progress = progressValue.data;
		}
		const processedRangeValue = NoticeJobRangeSchema.safeParse(record.processedRange);
		if (processedRangeValue.success) {
			processedRange = processedRangeValue.data;
		}
		const maintenanceRangeValue = NoticeJobRangeSchema.safeParse(record.maintenanceRange);
		if (maintenanceRangeValue.success) {
			maintenanceRange = maintenanceRangeValue.data;
		}
		const summaryValue = parseScalarSummary(record.summary);
		if (summaryValue) {
			summary = summaryValue;
		}
		if (typeof record.error === "string" && record.error.length > 0) {
			errorLines.push(record.error);
		}
		const structured = [
			"error",
			"maintenanceRange",
			"processedRange",
			"progress",
			"range",
			"status",
			"summary",
		].some((key) => Object.hasOwn(record, key));
		if (!structured) {
			errorLines.push(line);
		}
	}
	return {
		error: errorLines.length > 0 ? errorLines.join("\n").trim() || null : null,
		maintenanceRange,
		processedRange,
		progress,
		summary,
	};
}

function parseScalarSummary(value: unknown): NoticeJob["summary"] {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	const known = Object.fromEntries(
		[
			"outcome",
			"reason",
			"failed",
			"assets",
			"attachmentsDownloaded",
			"attachmentsMissing",
			"attachmentsReused",
			"classified",
			"imagesDownloaded",
			"imagesReused",
			"notices",
			"noticesFailed",
			"noticesProcessed",
			"noticesAdded",
			"objectsReused",
			"objectsWritten",
			"pagesFetched",
			"requested",
			"skipped",
			"unchanged",
			"updated",
			"upToDate",
		].flatMap((key) => (Object.hasOwn(record, key) ? [[key, record[key]]] : [])),
	);
	if (Object.keys(known).length === 0) {
		return null;
	}
	const parsed = NoticeJobSummarySchema.safeParse(known);
	return parsed.success ? parsed.data : null;
}

export function parseNoticeJobSummary(logs: string): NoticeJob["summary"] {
	return parseNoticeJobDiagnostics(logs).summary;
}

function emptyDiagnostics(): NoticeJobDiagnostics {
	return {
		error: null,
		maintenanceRange: null,
		processedRange: null,
		progress: null,
		summary: null,
	};
}

function hasReadableContainerLog(pod: V1Pod, containerName: string): boolean {
	if (!pod.spec?.containers.some((entry) => entry.name === containerName)) {
		return false;
	}
	const state = pod.status?.containerStatuses?.find((entry) => entry.name === containerName)?.state;
	return Boolean(state?.running || state?.terminated);
}

function podCreationTime(pod: V1Pod): number {
	const value = pod.metadata?.creationTimestamp;
	if (!value) {
		return 0;
	}
	return value instanceof Date ? value.valueOf() : new Date(value).valueOf();
}

function controllerError(
	condition: { message?: string; reason?: string } | undefined,
): string | null {
	if (!condition) {
		return null;
	}
	const reason = condition.reason?.trim();
	const message = condition.message?.trim();
	if (reason && message && reason !== message) {
		return `${reason}: ${message}`;
	}
	return reason || message || null;
}

function iso(value: Date | string | undefined): string | null {
	if (!value) {
		return null;
	}
	return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isActive(status: NoticeJob["status"]): boolean {
	return status === "pending" || status === "running";
}

function singleNoticeOperation(operation: NoticeJobOperation): boolean {
	return (
		operation === "notice-classify-one" ||
		operation === "notice-publish-one" ||
		operation === "notice-republish-one"
	);
}

function parseNoticeId(value: string | undefined): number | null {
	if (value === undefined) {
		return null;
	}
	const noticeId = Number(value);
	if (!(Number.isSafeInteger(noticeId) && noticeId > 0)) {
		throw new NoticeJobUnavailableError("Kubernetes 返回了无效的通知任务。");
	}
	return noticeId;
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

function mapKubernetesError(error: unknown): NoticeJobUnavailableError {
	return error instanceof NoticeJobUnavailableError
		? error
		: new NoticeJobUnavailableError(undefined, { cause: error });
}

function unavailableStore(cause: unknown): NoticeJobStore {
	const fail = () => Promise.reject(new NoticeJobUnavailableError(undefined, { cause }));
	return { create: fail, get: fail, list: fail };
}
