import { createServer } from "node:http";
import { loadIngestionTaskRegistryCatalogFromRoot } from "ingest-core/node";
import { Pool } from "pg";
import {
	createIngestionControlHandler,
	type IngestionControlHandler,
	type IngestionControlServiceTokens,
} from "./http";
import {
	assertIngestionControlPostgresSchema,
	createPostgresIngestionTaskStore,
} from "./postgres-store";
import {
	type ClosableIngestionWorkflowStarter,
	createTemporalIngestionWorkflowStarter,
	type IngestionWorkflowStarter,
} from "./temporal-client";
import { buildIngestionTemporalConfig, type IngestionTemporalConfig } from "./temporal-config";
import type { IngestionTaskStore } from "./types";

const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
const API_DATABASE_TIMEOUT_MS = 4_000;

export interface IngestionControlRuntimeConfig {
	databaseUrl: string;
	registryRoot: string;
	host: string;
	port: number;
	serviceTokens: Required<IngestionControlServiceTokens>;
	temporal: IngestionTemporalConfig;
}

export interface IngestionControlRuntime {
	close(): Promise<void>;
	readinessCheck(): Promise<void>;
	registryCatalog: ReturnType<typeof loadIngestionTaskRegistryCatalogFromRoot>;
	store: IngestionTaskStore;
	workflowStarter: IngestionWorkflowStarter;
}

export function buildIngestionControlRuntimeConfig(
	env: Record<string, string | undefined>,
): IngestionControlRuntimeConfig {
	return {
		databaseUrl: requiredEnv(env, "INGESTION_CONTROL_DATABASE_URL"),
		registryRoot: requiredEnv(env, "INGESTION_TASK_REGISTRY_ROOT"),
		host: env.INGESTION_CONTROL_HOST?.trim() || "0.0.0.0",
		port: readPort(env.INGESTION_CONTROL_PORT),
		serviceTokens: {
			adminToken: env.INGESTION_CONTROL_ADMIN_TOKEN?.trim() || null,
			opsToken: env.OPS_WEB_INTERNAL_TOKEN?.trim() || null,
		},
		temporal: buildIngestionTemporalConfig(env),
	};
}

export async function startIngestionControlServer(
	config: IngestionControlRuntimeConfig,
	input: { runtime?: IngestionControlRuntime } = {},
): Promise<{ close(): Promise<void> }> {
	const runtime = input.runtime ?? (await createIngestionControlRuntime(config));
	const handler = createIngestionControlHandler({
		readinessCheck: runtime.readinessCheck,
		registryCatalog: runtime.registryCatalog,
		serviceTokens: config.serviceTokens,
		store: runtime.store,
		workflowStarter: runtime.workflowStarter,
	});
	const server = createServer((request, response) => {
		void serveNodeRequest({ handler, request, response }).catch((error) => {
			if (response.destroyed || response.writableEnded) {
				return;
			}
			response.statusCode = error instanceof RequestBodyTooLargeError ? 413 : 500;
			response.setHeader("content-type", "application/json");
			response.end(
				JSON.stringify({
					error:
						error instanceof RequestBodyTooLargeError
							? "request_body_too_large"
							: "internal_server_error",
				}),
			);
		});
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
		async close() {
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
			await runtime.close();
		},
	};
}

async function createIngestionControlRuntime(
	config: Pick<IngestionControlRuntimeConfig, "databaseUrl" | "registryRoot" | "temporal">,
): Promise<IngestionControlRuntime> {
	const pool = new Pool({
		connectionString: config.databaseUrl,
		connectionTimeoutMillis: API_DATABASE_TIMEOUT_MS,
		query_timeout: API_DATABASE_TIMEOUT_MS,
		statement_timeout: API_DATABASE_TIMEOUT_MS,
	});
	let workflowStarter: ClosableIngestionWorkflowStarter | null = null;
	try {
		await assertIngestionControlPostgresSchema(pool);
		workflowStarter = await createTemporalIngestionWorkflowStarter(config.temporal);
		return {
			async close() {
				await workflowStarter?.close();
				await pool.end();
			},
			async readinessCheck() {
				await Promise.all([pool.query("SELECT 1"), workflowStarter?.checkReady()]);
			},
			registryCatalog: loadIngestionTaskRegistryCatalogFromRoot(config.registryRoot),
			store: createPostgresIngestionTaskStore({ pool }),
			workflowStarter,
		};
	} catch (error) {
		await workflowStarter?.close();
		await pool.end();
		throw error;
	}
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

export async function readRequestBody(
	request: import("node:http").IncomingMessage,
): Promise<Buffer> {
	const contentLength = Number(request.headers["content-length"] ?? 0);
	if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
		request.resume();
		throw new RequestBodyTooLargeError();
	}
	const chunks: Buffer[] = [];
	let byteLength = 0;
	for await (const chunk of request) {
		const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		byteLength += bytes.byteLength;
		if (byteLength > MAX_REQUEST_BODY_BYTES) {
			request.resume();
			throw new RequestBodyTooLargeError();
		}
		chunks.push(bytes);
	}
	return Buffer.concat(chunks);
}

async function serveNodeRequest(input: {
	handler: IngestionControlHandler;
	request: import("node:http").IncomingMessage;
	response: import("node:http").ServerResponse;
}): Promise<void> {
	const body = await readRequestBody(input.request);
	const runtimeRequest = new Request(`http://ingestion-control${input.request.url ?? "/"}`, {
		body: body.length > 0 ? new Uint8Array(body) : undefined,
		headers: input.request.headers as HeadersInit,
		method: input.request.method,
	});
	const runtimeResponse = await input.handler(runtimeRequest);
	input.response.statusCode = runtimeResponse.status;
	runtimeResponse.headers.forEach((value, key) => {
		input.response.setHeader(key, value);
	});
	input.response.end(Buffer.from(await runtimeResponse.arrayBuffer()));
}

class RequestBodyTooLargeError extends Error {}
