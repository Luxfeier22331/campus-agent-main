import { createServer } from "node:http";
import { Pool } from "pg";

import { createDefaultTsTaskHandlerRegistry } from "./default-handlers";
import { type IngestionExecutorRuntimeConfig, runIngestionExecutorLoop } from "./executor-runtime";
import { createIngestionControlHandler } from "./http";
import { createS3IngestionObjectStoreFromEnv } from "./object-store";
import {
	createPostgresIngestionTaskStore,
	ensureIngestionControlPostgresSchema,
} from "./postgres-store";
import { createDefaultRustKernelRegistry } from "./rust-kernel-runner";
import { loadIngestionTaskRegistryCatalogFromRoot } from "./task-registry";
import type { IngestionTaskStore } from "./types";

export interface IngestionControlRuntimeConfig {
	databaseUrl: string;
	registryRoot: string;
	host: string;
	port: number;
}

export interface IngestionControlRuntime {
	close(): Promise<void>;
	registryCatalog: ReturnType<typeof loadIngestionTaskRegistryCatalogFromRoot>;
	store: IngestionTaskStore;
}

export function buildIngestionControlRuntimeConfig(
	env: Record<string, string | undefined>,
): IngestionControlRuntimeConfig {
	const databaseUrl = requiredEnv(env, "INGESTION_CONTROL_DATABASE_URL");
	return {
		databaseUrl,
		registryRoot: requiredEnv(env, "INGESTION_TASK_REGISTRY_ROOT"),
		host: env.INGESTION_CONTROL_HOST?.trim() || "0.0.0.0",
		port: readPort(env.INGESTION_CONTROL_PORT),
	};
}

export async function startIngestionControlServer(
	config: IngestionControlRuntimeConfig,
	input: { runtime?: IngestionControlRuntime } = {},
): Promise<{ close(): Promise<void> }> {
	const runtime = input.runtime ?? (await createIngestionControlRuntime(config));
	const handler = createIngestionControlHandler({
		registryCatalog: runtime.registryCatalog,
		store: runtime.store,
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

export async function startIngestionControlExecutor(
	config: IngestionExecutorRuntimeConfig,
	input: { stopSignal?: AbortSignal } = {},
): Promise<void> {
	const runtime = await createIngestionControlRuntime(config);
	const objectStore = createS3IngestionObjectStoreFromEnv(process.env);
	try {
		await runIngestionExecutorLoop({
			pollIntervalMs: config.pollIntervalMs,
			registryCatalog: runtime.registryCatalog,
			rustKernels: createDefaultRustKernelRegistry({
				objectStore,
			}),
			stopSignal: input.stopSignal,
			store: runtime.store,
			tsHandlers: createDefaultTsTaskHandlerRegistry({
				authenticatedNoticeObjectStore: objectStore,
				officialWebObjectStore: objectStore,
				wechatOfficialAccountObjectStore: objectStore,
			}),
			workerId: config.workerId,
		});
	} finally {
		await runtime.close();
	}
}

export { buildIngestionExecutorRuntimeConfig } from "./executor-runtime";

async function createIngestionControlRuntime(
	config: Pick<IngestionControlRuntimeConfig, "databaseUrl" | "registryRoot">,
): Promise<IngestionControlRuntime> {
	const pool = new Pool({ connectionString: config.databaseUrl });
	await ensureIngestionControlPostgresSchema(pool);
	return {
		async close(): Promise<void> {
			await pool.end();
		},
		registryCatalog: loadIngestionTaskRegistryCatalogFromRoot(config.registryRoot),
		store: createPostgresIngestionTaskStore({ pool }),
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
