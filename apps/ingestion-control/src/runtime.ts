import { createServer } from "node:http";
import { Pool } from "pg";
import { createIngestionControlHandler, type IngestionControlHandler } from "./http.ts";
import { createInternalPortalCredentialService } from "./internal-portal-credential-service.ts";
import {
	assertInternalPortalCredentialSchema,
	createPgInternalPortalCredentialStore,
} from "./internal-portal-credential-store.ts";
import { type PostgresConnectionConfig, readPostgresConnectionConfig } from "./postgres-config.ts";

const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
const API_DATABASE_TIMEOUT_MS = 4_000;

export interface IngestionControlRuntimeConfig {
	database: PostgresConnectionConfig;
	host: string;
	internalToken: string | null;
	port: number;
}

export interface IngestionControlRuntime {
	close(): Promise<void>;
	handler: IngestionControlHandler;
	readinessCheck(): Promise<void>;
}

export function buildIngestionControlRuntimeConfig(
	env: Record<string, string | undefined>,
): IngestionControlRuntimeConfig {
	return {
		database: readPostgresConnectionConfig(env, {
			caCertPath: "INGESTION_CONTROL_DATABASE_CA_CERT_PATH",
			connectionString: "INGESTION_CONTROL_DATABASE_URL",
			sslMode: "INGESTION_CONTROL_DATABASE_SSLMODE",
		}),
		host: "0.0.0.0",
		internalToken: env.OPS_WEB_INTERNAL_TOKEN?.trim() || null,
		port: 8000,
	};
}

export async function createIngestionControlRuntime(
	config: Pick<IngestionControlRuntimeConfig, "database" | "internalToken">,
): Promise<IngestionControlRuntime> {
	const pool = new Pool({
		...config.database,
		connectionTimeoutMillis: API_DATABASE_TIMEOUT_MS,
		query_timeout: API_DATABASE_TIMEOUT_MS,
		statement_timeout: API_DATABASE_TIMEOUT_MS,
	});
	pool.on("error", () => {
		console.error(
			JSON.stringify({
				error_code: "postgres_pool_error",
				event_type: "ingestion_control.postgres_pool_error",
				level: "error",
				status: "failed",
			}),
		);
	});
	try {
		await assertInternalPortalCredentialSchema(pool);
		const credentialService = createInternalPortalCredentialService({
			store: createPgInternalPortalCredentialStore(pool),
		});
		const readinessCheck = async () => {
			await pool.query("SELECT 1");
		};
		return {
			async close() {
				await pool.end();
			},
			handler: createIngestionControlHandler({
				credentialService,
				internalToken: config.internalToken,
				readinessCheck,
			}),
			readinessCheck,
		};
	} catch (error) {
		await pool.end();
		throw error;
	}
}

export async function startIngestionControlServer(
	config: IngestionControlRuntimeConfig,
	input: { runtime?: IngestionControlRuntime } = {},
): Promise<{ close(): Promise<void> }> {
	const runtime = input.runtime ?? (await createIngestionControlRuntime(config));
	const server = createServer((request, response) => {
		void serveNodeRequest({ handler: runtime.handler, request, response }).catch((error) => {
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
		...(body.length > 0 ? { body: new Uint8Array(body) } : {}),
		headers: input.request.headers as HeadersInit,
		...(input.request.method ? { method: input.request.method } : {}),
	});
	const runtimeResponse = await input.handler(runtimeRequest);
	input.response.statusCode = runtimeResponse.status;
	runtimeResponse.headers.forEach((value, key) => {
		input.response.setHeader(key, value);
	});
	input.response.end(Buffer.from(await runtimeResponse.arrayBuffer()));
}

class RequestBodyTooLargeError extends Error {}
