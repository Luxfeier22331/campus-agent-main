import { createServer } from "node:http";
import { Pool } from "pg";

import { createIngestionControlHandler } from "./http";
import {
	createOfficialWebControlPlaneService,
	type OfficialWebControlPlaneService,
} from "./official-web-control-plane-service";
import { createPgOfficialWebControlPlaneStore } from "./official-web-control-plane-store";
import {
	buildOfficialWebExecutionStatusService,
	type OfficialWebExecutionStatusService,
} from "./official-web-execution-status-service";
import {
	buildOfficialWebProjectionProjector,
	type OfficialWebProjectionProjector,
} from "./official-web-projection-service";
import {
	createPgOfficialWebProjectionStore,
	ensureOfficialWebPostgresSchema,
} from "./official-web-projection-store";
import {
	createPostgresIngestionTaskStore,
	ensureIngestionControlPostgresSchema,
} from "./postgres-store";
import { loadIngestionTaskRegistryCatalogFromRoot } from "./task-registry";
import {
	type ClosableIngestionWorkflowStarter,
	createTemporalIngestionWorkflowStarter,
	type IngestionWorkflowStarter,
} from "./temporal-client";
import { buildIngestionTemporalConfig, type IngestionTemporalConfig } from "./temporal-config";
import type { IngestionTaskStore } from "./types";

export interface IngestionControlRuntimeConfig {
	databaseUrl: string;
	registryRoot: string;
	host: string;
	officialWebCollectorToken: string | null;
	port: number;
	sourceBucket: string;
	temporal: IngestionTemporalConfig;
}

export interface IngestionControlRuntime {
	close(): Promise<void>;
	officialWebControlPlaneService: OfficialWebControlPlaneService;
	officialWebExecutionStatusService: OfficialWebExecutionStatusService;
	officialWebProjectionProjector: OfficialWebProjectionProjector;
	registryCatalog: ReturnType<typeof loadIngestionTaskRegistryCatalogFromRoot>;
	store: IngestionTaskStore;
	workflowStarter: IngestionWorkflowStarter;
}

export function buildIngestionControlRuntimeConfig(
	env: Record<string, string | undefined>,
): IngestionControlRuntimeConfig {
	const databaseUrl = requiredEnv(env, "INGESTION_CONTROL_DATABASE_URL");
	return {
		databaseUrl,
		registryRoot: requiredEnv(env, "INGESTION_TASK_REGISTRY_ROOT"),
		host: env.INGESTION_CONTROL_HOST?.trim() || "0.0.0.0",
		officialWebCollectorToken: env.INGESTION_CONTROL_OFFICIAL_WEB_COLLECTOR_TOKEN?.trim() || null,
		port: readPort(env.INGESTION_CONTROL_PORT),
		sourceBucket: env.OBJECT_STORE_BUCKET_SOURCE?.trim() || "campus-agent-source",
		temporal: buildIngestionTemporalConfig(env),
	};
}

export async function startIngestionControlServer(
	config: IngestionControlRuntimeConfig,
	input: { runtime?: IngestionControlRuntime } = {},
): Promise<{ close(): Promise<void> }> {
	const runtime = input.runtime ?? (await createIngestionControlRuntime(config));
	const handler = createIngestionControlHandler({
		officialWebCollectorToken: config.officialWebCollectorToken,
		officialWebControlPlaneService: runtime.officialWebControlPlaneService,
		officialWebExecutionStatusService: runtime.officialWebExecutionStatusService,
		officialWebProjectionProjector: runtime.officialWebProjectionProjector,
		registryCatalog: runtime.registryCatalog,
		store: runtime.store,
		workflowStarter: runtime.workflowStarter,
	});

	const server = createServer(async (request, response) => {
		const body = await readRequestBody(request);
		const runtimeRequest = new Request(`http://ingestion-control${request.url ?? "/"}`, {
			body: body.length > 0 ? new Uint8Array(body) : undefined,
			headers: request.headers as HeadersInit,
			method: request.method,
		});
		const runtimeResponse = await handler(runtimeRequest);
		response.statusCode = runtimeResponse.status;
		runtimeResponse.headers.forEach((value, key) => {
			response.setHeader(key, value);
		});
		response.end(Buffer.from(await runtimeResponse.arrayBuffer()));
	});

	try {
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(config.port, config.host, () => {
				server.off("error", reject);
				resolve();
			});
		});
	} catch (error) {
		await runtime.close();
		throw error;
	}

	return {
		async close(): Promise<void> {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			});
			await runtime.close();
		},
	};
}

async function createIngestionControlRuntime(
	config: Pick<
		IngestionControlRuntimeConfig,
		"databaseUrl" | "registryRoot" | "sourceBucket" | "temporal"
	>,
): Promise<IngestionControlRuntime> {
	const pool = new Pool({ connectionString: config.databaseUrl });
	let workflowStarter: ClosableIngestionWorkflowStarter | null = null;
	await ensureIngestionControlPostgresSchema(pool);
	await ensureOfficialWebPostgresSchema(pool);
	workflowStarter = await createTemporalIngestionWorkflowStarter(config.temporal);
	const registryCatalog = loadIngestionTaskRegistryCatalogFromRoot(config.registryRoot);
	const store = createPostgresIngestionTaskStore({ pool });
	const officialWebProjectionStore = createPgOfficialWebProjectionStore({ pool });
	return {
		async close(): Promise<void> {
			await workflowStarter?.close();
			await pool.end();
		},
		officialWebControlPlaneService: createOfficialWebControlPlaneService({
			store: createPgOfficialWebControlPlaneStore({ pool }),
		}),
		officialWebExecutionStatusService: buildOfficialWebExecutionStatusService({
			store: officialWebProjectionStore,
		}),
		officialWebProjectionProjector: buildOfficialWebProjectionProjector({
			registryCatalog,
			sourceBucket: config.sourceBucket,
			store: officialWebProjectionStore,
			taskStore: store,
			workflowStarter,
		}),
		registryCatalog,
		store,
		workflowStarter,
	};
}

function requiredEnv(env: Record<string, string | undefined>, key: string): string {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`${key} is required`);
	}
	return value;
}

function readPort(value: string | undefined): number {
	if (!value?.trim()) {
		return 8000;
	}
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
		throw new Error("INGESTION_CONTROL_PORT must be a valid TCP port");
	}
	return parsed;
}

async function readRequestBody(request: import("node:http").IncomingMessage): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}
