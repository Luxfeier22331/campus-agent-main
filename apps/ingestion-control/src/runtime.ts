import { createServer } from "node:http";
import { Pool } from "pg";

import { createIngestionControlHandler } from "./http";
import {
	createPostgresIngestionTaskStore,
	ensureIngestionControlPostgresSchema,
} from "./postgres-store";

export interface IngestionControlRuntimeConfig {
	databaseUrl: string;
	host: string;
	port: number;
}

export function buildIngestionControlRuntimeConfig(
	env: Record<string, string | undefined>,
): IngestionControlRuntimeConfig {
	const databaseUrl = requiredEnv(env, "INGESTION_CONTROL_DATABASE_URL");
	return {
		databaseUrl,
		host: env.INGESTION_CONTROL_HOST?.trim() || "0.0.0.0",
		port: readPort(env.INGESTION_CONTROL_PORT),
	};
}

export async function startIngestionControlServer(
	config: IngestionControlRuntimeConfig,
): Promise<{ close(): Promise<void> }> {
	const pool = new Pool({ connectionString: config.databaseUrl });
	await ensureIngestionControlPostgresSchema(pool);
	const handler = createIngestionControlHandler({
		store: createPostgresIngestionTaskStore({ pool }),
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

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(config.port, config.host, () => {
			server.off("error", reject);
			resolve();
		});
	});

	return {
		async close(): Promise<void> {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			});
			await pool.end();
		},
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
