import { request as httpsRequest } from "node:https";
import { startKubectlPortForward } from "../../../jobs/campus-rag-index-publisher/src/kubectl.ts";
import { createS3ReaderStoreFromConfig } from "../../../jobs/campus-rag-index-publisher/src/object-store.ts";
import {
	connectProductDatabase,
	readProductClusterSecret,
} from "./product-data-cluster-database.ts";
import { RetryableProductTransferError } from "./product-data-errors.ts";

export async function connectProductContentCluster(
	context: string | undefined,
	namespace: string,
	signal?: AbortSignal,
) {
	const postgres = await connectProductDatabase(context, namespace, signal);
	let forward: { close(): Promise<void>; port: number } | undefined;
	let closing: Promise<void> | undefined;
	const close = () =>
		(closing ??= (async () => {
			await postgres.close();
			await forward?.close();
		})());
	try {
		const objects = await readProductClusterSecret(context, namespace, "objectstore-ro", signal);
		forward = await startKubectlPortForward({
			...(context?.trim() ? { context: context.trim() } : {}),
			namespace,
			kubectlPath: "kubectl",
			service: "object-store",
			remotePort: 9000,
			...(signal ? { signal } : {}),
		});
		const sourceStore = createS3ReaderStoreFromConfig(
			{
				endpoint: `http://127.0.0.1:${forward.port}`,
				bucket: "campus-agent-source",
				accessKeyId: objects.OBJECT_STORE_HUMANS_SOURCE_ACCESS_KEY ?? "",
				secretAccessKey: objects.OBJECT_STORE_HUMANS_SOURCE_SECRET_KEY ?? "",
			},
			signal,
		);
		return { database: postgres.database, sourceStore, close };
	} catch (error) {
		await close();
		throw error;
	}
}

export async function connectProductCluster(
	context: string | undefined,
	namespace: string,
	signal?: AbortSignal,
) {
	if (!namespace.trim()) {
		throw new Error("Explicit cluster namespace is required");
	}
	const forwards: Array<{ close(): Promise<void> }> = [];
	let postgres: Awaited<ReturnType<typeof connectProductDatabase>> | undefined;
	let closing: Promise<void> | undefined;
	const close = () =>
		(closing ??= (async () => {
			signal?.removeEventListener("abort", interrupt);
			await postgres?.close();
			await Promise.allSettled(forwards.map((forward) => forward.close()));
		})());
	const interrupt = () => {
		void close();
	};
	signal?.throwIfAborted();
	signal?.addEventListener("abort", interrupt, { once: true });

	try {
		postgres = await connectProductDatabase(context, namespace, signal);
		const database = postgres.database;
		const [objects, vectors] = await Promise.all([
			readProductClusterSecret(context, namespace, "objectstore-ro", signal),
			readProductClusterSecret(context, namespace, "qdrant-ro", signal),
		]);
		const forward = async (service: string, remotePort: number) => {
			const result = await startKubectlPortForward({
				...(context?.trim() ? { context: context.trim() } : {}),
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
