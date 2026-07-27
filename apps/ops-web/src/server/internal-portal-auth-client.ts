import { readFileSync } from "node:fs";
import {
	BatchV1Api,
	CoreV1Api,
	KubeConfig,
	KubernetesObjectApi,
	PatchStrategy,
	type V1CronJob,
	type V1Secret,
} from "@kubernetes/client-node";
import {
	type InternalPortalAuthStatus,
	InternalPortalAuthStatusSchema,
} from "../shared/ops-contract.ts";

export const INTERNAL_PORTAL_AUTH_SECRET_NAME = "source-collector-internal-portal-auth";
export const INTERNAL_PORTAL_AUTH_CRON_JOB_NAME = "source-collector-auth-check";
export const INTERNAL_PORTAL_AUTH_UPDATED_AT_ANNOTATION = "campus-agent.muc.wiki/tgc-updated-at";

const SERVICE_ACCOUNT_NAMESPACE_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/namespace";

export interface InternalPortalAuthClient {
	getStatus(): Promise<InternalPortalAuthStatus>;
	replaceCredential(ssoTgc: string): Promise<InternalPortalAuthStatus>;
}

export class InternalPortalAuthUnavailableError extends Error {
	readonly code = "INTERNAL_PORTAL_AUTH_UNAVAILABLE";

	constructor(options?: ErrorOptions) {
		super("Internal portal authentication resources are unavailable.", options);
		this.name = "InternalPortalAuthUnavailableError";
	}
}

interface InternalPortalAuthResourceClient {
	patchSecret(secret: V1Secret): Promise<unknown>;
	readCronJob(): Promise<V1CronJob>;
	readSecret(): Promise<V1Secret>;
}

export function createInternalPortalAuthClient(input: {
	now?: () => Date;
	resources: InternalPortalAuthResourceClient;
}): InternalPortalAuthClient {
	const now = input.now ?? (() => new Date());

	async function getStatus(): Promise<InternalPortalAuthStatus> {
		try {
			const [secret, cronJob] = await Promise.all([
				input.resources.readSecret(),
				input.resources.readCronJob(),
			]);
			return mapInternalPortalAuthStatus(secret, cronJob);
		} catch (error) {
			throw toUnavailableError(error);
		}
	}

	return {
		getStatus,
		async replaceCredential(ssoTgc) {
			const current = await getStatus();
			const credentialUpdatedAt = now().toISOString();
			try {
				await input.resources.patchSecret({
					apiVersion: "v1",
					kind: "Secret",
					metadata: {
						annotations: {
							[INTERNAL_PORTAL_AUTH_UPDATED_AT_ANNOTATION]: credentialUpdatedAt,
						},
						name: INTERNAL_PORTAL_AUTH_SECRET_NAME,
					},
					stringData: { sso_tgc: ssoTgc },
				});
			} catch (error) {
				throw toUnavailableError(error);
			}
			return InternalPortalAuthStatusSchema.parse({
				...current,
				credentialUpdatedAt,
				currentCredentialChecked: false,
			});
		},
	};
}

export function createClusterInternalPortalAuthClient(): InternalPortalAuthClient {
	try {
		const namespace = readNamespace();
		const kubeConfig = new KubeConfig();
		kubeConfig.loadFromCluster();
		const core = kubeConfig.makeApiClient(CoreV1Api);
		const batch = kubeConfig.makeApiClient(BatchV1Api);
		const objects = KubernetesObjectApi.makeApiClient(kubeConfig);
		return createInternalPortalAuthClient({
			resources: {
				patchSecret: (secret) =>
					objects.patch(
						{ ...secret, metadata: { ...secret.metadata, namespace } },
						undefined,
						undefined,
						undefined,
						undefined,
						PatchStrategy.MergePatch,
					),
				readCronJob: () =>
					batch.readNamespacedCronJob({
						name: INTERNAL_PORTAL_AUTH_CRON_JOB_NAME,
						namespace,
					}),
				readSecret: () =>
					core.readNamespacedSecret({
						name: INTERNAL_PORTAL_AUTH_SECRET_NAME,
						namespace,
					}),
			},
		});
	} catch (error) {
		return createUnavailableInternalPortalAuthClient(error);
	}
}

export function mapInternalPortalAuthStatus(
	secret: V1Secret,
	cronJob: V1CronJob,
): InternalPortalAuthStatus {
	const credentialUpdatedAt = resolveCredentialUpdatedAt(secret);
	const lastScheduledAt = optionalTimestamp(cronJob.status?.lastScheduleTime);
	const lastSuccessfulAt = optionalTimestamp(cronJob.status?.lastSuccessfulTime);
	const latestRun = resolveLatestRun({
		active: cronJob.status?.active?.length ?? 0,
		lastScheduledAt,
		lastSuccessfulAt,
	});
	return InternalPortalAuthStatusSchema.parse({
		credentialUpdatedAt,
		currentCredentialChecked:
			latestRun === "succeeded" &&
			lastScheduledAt !== null &&
			new Date(lastScheduledAt).valueOf() >= new Date(credentialUpdatedAt).valueOf(),
		lastScheduledAt,
		lastSuccessfulAt,
		latestRun,
	});
}

function resolveCredentialUpdatedAt(secret: V1Secret): string {
	const annotated = secret.metadata?.annotations?.[INTERNAL_PORTAL_AUTH_UPDATED_AT_ANNOTATION];
	if (annotated !== undefined) {
		return requiredTimestamp(annotated);
	}
	return requiredTimestamp(secret.metadata?.creationTimestamp);
}

function resolveLatestRun(input: {
	active: number;
	lastScheduledAt: string | null;
	lastSuccessfulAt: string | null;
}): InternalPortalAuthStatus["latestRun"] {
	if (input.active > 0) {
		return "running";
	}
	if (!input.lastScheduledAt) {
		return "never_run";
	}
	return input.lastSuccessfulAt &&
		new Date(input.lastSuccessfulAt).valueOf() >= new Date(input.lastScheduledAt).valueOf()
		? "succeeded"
		: "failed";
}

function optionalTimestamp(value: Date | string | undefined): string | null {
	return value === undefined ? null : requiredTimestamp(value);
}

function requiredTimestamp(value: Date | string | undefined): string {
	const parsed = value instanceof Date ? value : new Date(value ?? Number.NaN);
	if (Number.isNaN(parsed.valueOf())) {
		throw new InternalPortalAuthUnavailableError();
	}
	return parsed.toISOString();
}

function readNamespace(): string {
	const namespace = readFileSync(SERVICE_ACCOUNT_NAMESPACE_PATH, "utf8").trim();
	if (!namespace) {
		throw new Error("Kubernetes namespace is empty.");
	}
	return namespace;
}

function createUnavailableInternalPortalAuthClient(cause: unknown): InternalPortalAuthClient {
	const unavailable = async (): Promise<never> => {
		throw toUnavailableError(cause);
	};
	return { getStatus: unavailable, replaceCredential: unavailable };
}

function toUnavailableError(error: unknown): InternalPortalAuthUnavailableError {
	return error instanceof InternalPortalAuthUnavailableError
		? error
		: new InternalPortalAuthUnavailableError({ cause: error });
}
