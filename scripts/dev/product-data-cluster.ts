import { execFile } from "node:child_process";
import { request as httpsRequest } from "node:https";
import { promisify } from "node:util";
import { Client } from "pg";
import { startKubectlPortForward } from "../../jobs/campus-rag-index-publisher/src/kubectl.ts";
import { createS3ReaderStoreFromConfig } from "../../jobs/campus-rag-index-publisher/src/object-store.ts";
import { RetryableProductTransferError } from "./product-data-errors.ts";

const exec = promisify(execFile);

export async function connectProductCluster(
	context: string,
	namespace: string,
	signal?: AbortSignal,
) {
	if (!(context.trim() && namespace.trim())) {
		throw new Error("Explicit cluster context and namespace are required");
	}
	const secret = async (name: string): Promise<Record<string, string>> => {
		let stdout: string;
		try {
			({ stdout } = await exec(
				"kubectl",
				["--context", context, "-n", namespace, "get", "secret", name, "-o", "json"],
				{ maxBuffer: 1024 * 1024, ...(signal ? { signal } : {}) },
			));
		} catch {
			throw new Error(`Cannot read collaborator Secret ${name} in the selected context/namespace`);
		}
		const data = JSON.parse(stdout).data as Record<string, string>;
		return Object.fromEntries(
			Object.entries(data).map(([key, value]) => [
				key,
				Buffer.from(value, "base64").toString("utf8"),
			]),
		);
	};
	const forwards: Array<{ close(): Promise<void> }> = [];
	let database: Client | undefined;
	let closing: Promise<void> | undefined;
	const close = () =>
		(closing ??= (async () => {
			signal?.removeEventListener("abort", interrupt);
			await database?.end().catch(() => undefined);
			await Promise.allSettled(forwards.map((forward) => forward.close()));
		})());
	const interrupt = () => {
		void close();
	};
	signal?.throwIfAborted();
	signal?.addEventListener("abort", interrupt, { once: true });

	try {
		const [pg, objects, vectors] = await Promise.all([
			secret("pg-product-data-ro"),
			secret("objectstore-ro"),
			secret("qdrant-ro"),
		]);
		const forward = async (service: string, remotePort: number) => {
			const result = await startKubectlPortForward({
				context,
				namespace,
				kubectlPath: "kubectl",
				service,
				remotePort,
				...(signal ? { signal } : {}),
			});
			forwards.push(result);
			if (signal?.aborted) {
				await result.close();
				signal.throwIfAborted();
			}
			return result.port;
		};
		if (
			!(pg["ca.crt"] && pg.host && pg.password && pg.database && /^[0-9]+$/u.test(pg.port ?? ""))
		) {
			throw new Error("Product PostgreSQL collaborator TLS configuration is incomplete");
		}
		const pgPort = await forward("campus-agent-postgres-rw", Number(pg.port));
		if (pg.username !== "product_data_ro") {
			throw new Error("Product pull requires the product_data_ro identity");
		}
		database = new Client({
			host: "127.0.0.1",
			port: pgPort,
			user: pg.username,
			password: pg.password,
			database: pg.database,
			connectionTimeoutMillis: 15_000,
			ssl: { ca: pg["ca.crt"], servername: pg.host, rejectUnauthorized: true },
		});
		await database.connect();
		const objectPort = await forward("object-store", 9000);
		const objectStore = createS3ReaderStoreFromConfig(
			{
				endpoint: `http://127.0.0.1:${objectPort}`,
				bucket: "campus-agent-derived",
				accessKeyId: objects.OBJECT_STORE_HUMANS_DERIVED_ACCESS_KEY ?? "",
				secretAccessKey: objects.OBJECT_STORE_HUMANS_DERIVED_SECRET_KEY ?? "",
			},
			signal,
		);
		const endpoint = new URL(vectors.endpoint ?? "");
		if (endpoint.protocol !== "https:" || !vectors["ca.crt"] || !vectors.QDRANT_READ_ONLY_API_KEY) {
			throw new Error("Qdrant collaborator TLS configuration is incomplete");
		}
		const vectorPort = await forward("qdrant", 6333);
		const qdrantRequest = (path: string, body?: unknown): Promise<unknown> =>
			new Promise((resolve, reject) => {
				const request = httpsRequest(
					{
						host: "127.0.0.1",
						port: vectorPort,
						servername: endpoint.hostname,
						ca: vectors["ca.crt"],
						rejectUnauthorized: true,
						path,
						method: body === undefined ? "GET" : "POST",
						headers: {
							"api-key": vectors.QDRANT_READ_ONLY_API_KEY ?? "",
							"content-type": "application/json",
							host: endpoint.host,
						},
						timeout: 30_000,
						...(signal ? { signal } : {}),
					},
					(response) => {
						const chunks: Buffer[] = [];
						let responseBytes = 0;
						response.on("data", (chunk: Buffer) => {
							responseBytes += chunk.length;
							if (responseBytes > 16 * 1024 * 1024) {
								const error = new Error(
									`Qdrant response exceeds 16 MiB (path=${path}, bytes=${responseBytes})`,
								);
								reject(error);
								response.destroy(error);
								return;
							}
							chunks.push(chunk);
						});
						response.on("error", (error) =>
							reject(
								new RetryableProductTransferError(
									`Qdrant response interrupted (path=${path}, bytes=${responseBytes}): ${error.message}`,
								),
							),
						);
						response.on("end", () => {
							if (!response.complete) {
								return reject(
									new RetryableProductTransferError(
										`Qdrant response truncated (path=${path}, bytes=${responseBytes})`,
									),
								);
							}
							if (response.statusCode !== 200) {
								return reject(
									new Error(
										`Qdrant collaborator request returned HTTP ${response.statusCode} (path=${path}, bytes=${responseBytes})`,
									),
								);
							}
							console.error(`[product-sync] Qdrant path=${path} bytes=${responseBytes}`);
							try {
								resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
							} catch (error) {
								reject(
									new Error(
										`Qdrant collaborator returned invalid JSON (path=${path}, bytes=${responseBytes}): ${error instanceof Error ? error.message : String(error)}`,
									),
								);
							}
						});
					},
				);
				request.on("error", (error: NodeJS.ErrnoException) =>
					reject(
						new (error.code && ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT"].includes(error.code)
							? RetryableProductTransferError
							: Error)(
							`Qdrant collaborator TLS request failed (path=${path}): ${error instanceof Error ? error.message : String(error)}`,
						),
					),
				);
				request.on("timeout", () => {
					reject(new RetryableProductTransferError(`Qdrant timeout (path=${path})`));
					request.destroy();
				});
				request.end(body === undefined ? undefined : JSON.stringify(body));
			});
		return { database, objectStore, qdrantRequest, close };
	} catch (error) {
		await close();
		throw error;
	}
}
