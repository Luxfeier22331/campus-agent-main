import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Client } from "pg";
import { createS3ObjectStore } from "../../../apps/campus-web/src/docs-reader-build/published-reader-object-store.ts";
import { createFilesystemArtifactStore } from "../../../jobs/campus-docs-index-publisher/src/filesystem-artifact-store.ts";
import { importCampusRagArtifacts } from "../../../jobs/retrieval-index/src/artifact-import.ts";
import { createPostgresIndexCatalog } from "../../../jobs/retrieval-index/src/catalog.ts";
import { createS3WriterStore } from "../../../jobs/retrieval-index/src/object-store.ts";
import { materializeCollection } from "../../../jobs/retrieval-index/src/publisher.ts";
import { createQdrantClient } from "../../../jobs/retrieval-index/src/qdrant.ts";
import { localDatabaseUrls } from "../lifecycle/environment.ts";
import { resolveLocalQdrantConnection } from "../lifecycle/local-qdrant.ts";
import { withLifecycleLock } from "../lifecycle/locks.ts";
import { probeLocalPorts } from "../lifecycle/ports.ts";
import { runCommand } from "../lifecycle/process.ts";
import {
	calculateLocalDevRuntimePorts,
	type LocalDevProfile,
	resolveLocalDevRegistryPath,
} from "../lifecycle/profile.ts";
import { localProductStoreEnv } from "./connections.ts";
import { connectProductCluster } from "./product-data-cluster.ts";
import {
	activateRetrievalIndex,
	exportRetrievalData,
	importRetrievalData,
	readRetrievalRows,
	withRetrievalExportLock,
} from "./product-data-database.ts";
import { downloadProductIndex } from "./product-data-index.ts";
import {
	copyDocsClosure,
	copyNoticeAssets,
	PRODUCT_DOCS_SOURCE_KEY,
	validateProductPoint,
} from "./product-data-resources.ts";
import { createProductSeed } from "./product-data-seed.ts";
import { readProductSeedIndex } from "./product-data-seed-index.ts";

export async function assertProductAppsOffline(profile: LocalDevProfile) {
	const ports = [
		profile.ports.appApi,
		profile.ports.campusWeb,
		profile.ports.opsWebApi,
		calculateLocalDevRuntimePorts(profile.slot).agentControl,
	];
	const result = await probeLocalPorts(ports);
	if (result.occupied.length > 0 || result.unknown.length > 0) {
		throw new Error(
			`Stop current data consumers before replacing retrieval data; ports: ${[...result.occupied, ...result.unknown].join(", ")}. Current worktree infrastructure stays running.`,
		);
	}
}

export async function initializeRetrievalData(
	repoRoot: string,
	profile: LocalDevProfile,
	options: { data: "seed" | "cluster"; replace: boolean; context?: string; namespace?: string },
) {
	const registry = dirname(resolveLocalDevRegistryPath(repoRoot));
	return withLifecycleLock(
		resolve(registry, `${profile.instanceId}-data.lock`),
		"product-data",
		async () => {
			const client = new Client({ connectionString: localDatabaseUrls(profile).owner });
			const env = localProductStoreEnv(repoRoot, profile);
			const target = createS3WriterStore(env);
			let temp: string | undefined;
			const controller = new AbortController();
			client.on("error", (error) => controller.abort(error));
			const interrupt = () => {
				process.exitCode = 130;
				controller.abort(new Error("Product data initialization interrupted"));
			};
			process.once("SIGINT", interrupt);
			process.once("SIGTERM", interrupt);
			const signal = controller.signal;
			try {
				await client.connect();
				if (!options.replace) {
					const existing = await client.query(
						"select 1 from campus_docs_serving.current_index limit 1",
					);
					if (existing.rows.length > 0) {
						console.log(JSON.stringify({ domain: "retrieval", status: "preserved" }));
						return;
					}
				}
				if (options.data === "cluster" || options.replace) {
					await assertProductAppsOffline(profile);
				}
				const qdrant = await resolveLocalQdrantConnection(repoRoot, profile);
				const prepareRetrieval = async (
					dataset: Awaited<ReturnType<typeof exportRetrievalData>>,
					source: Parameters<typeof copyDocsClosure>[0],
					candidate: Parameters<typeof materializeCollection>[1],
				) => {
					await importCampusRagArtifacts({
						docsEmbeddingSet: dataset.docsEmbeddingSet,
						noticeEmbeddingSet: dataset.noticeEmbeddingSet,
						sourceStore: source,
						targetStore: target,
					});
					const docs = await copyDocsClosure(source, target);
					await copyNoticeAssets(dataset.rows, source, target);
					const points =
						typeof candidate.points === "function" ? candidate.points() : candidate.points;
					for await (const point of points) {
						validateProductPoint(point, dataset.rows, docs.references);
					}
					return docs;
				};
				const applyPreparedRetrieval = async (
					dataset: Awaited<ReturnType<typeof exportRetrievalData>>,
					docs: Awaited<ReturnType<typeof copyDocsClosure>>,
					candidate: Parameters<typeof materializeCollection>[1],
				) => {
					await withLifecycleLock(
						resolve(registry, "qdrant-materialize.lock"),
						"product-data-index",
						async () => {
							const catalog = createPostgresIndexCatalog({
								AGENT_CONTROL_DATABASE_URL: localDatabaseUrls(profile).owner,
							});
							try {
								await catalog.acquirePublisherLock();
								const publishSignal = AbortSignal.any([signal, catalog.signal]);
								const qdrantClient = createQdrantClient({
									QDRANT_URL: qdrant.url,
									QDRANT_API_KEY: qdrant.apiKey,
								});
								await qdrantClient.deleteCollection(dataset.collection);
								await materializeCollection(
									createQdrantClient(
										{ QDRANT_URL: qdrant.url, QDRANT_API_KEY: qdrant.apiKey },
										async (url, init) => {
											if (init?.method !== "DELETE") {
												signal.throwIfAborted();
											}
											return fetch(url, {
												...init,
												signal: AbortSignal.any([publishSignal, AbortSignal.timeout(120_000)]),
											});
										},
									),
									candidate,
									publishSignal,
								);
								publishSignal.throwIfAborted();
								await createS3ObjectStore(env).writeBytesObject({
									key: PRODUCT_DOCS_SOURCE_KEY,
									body: docs.sourceBytes,
									contentType: "application/json",
								});
								runCommand(
									"pnpm",
									["exec", "tsx", "scripts/prepare-docs-content.ts", "--refresh"],
									{
										cwd: resolve(repoRoot, "apps/campus-web"),
										env: { ...process.env, ...env },
										timeout: 120_000,
									},
								);
								if (options.data === "cluster") {
									await importRetrievalData(client, dataset);
								} else {
									await activateRetrievalIndex(client, dataset);
								}
							} finally {
								await catalog.close();
							}
						},
					);
				};
				if (options.data === "seed") {
					const seed = createProductSeed(new Date());
					const rows = await readRetrievalRows(client);
					for (const expected of seed.rows["notices.notices"].filter(
						(row) => row.is_published && !row.is_external,
					)) {
						const actual = rows["notices.notices"].find(
							(row) => String(row.notice_id) === String(expected.notice_id),
						);
						if (
							!actual ||
							["title", "content_text", "is_published", "is_external"].some(
								(key) => actual[key] !== expected[key],
							)
						) {
							throw new Error(
								"Retrieval seed requires matching notice samples; preserve edited notices and publish their own index instead.",
							);
						}
					}
					const docsBytes = await target.read(PRODUCT_DOCS_SOURCE_KEY);
					const expectedDocs = seed.objects.get(PRODUCT_DOCS_SOURCE_KEY);
					if (!(expectedDocs && Buffer.from(docsBytes).equals(Buffer.from(expectedDocs.body)))) {
						throw new Error(
							"Retrieval seed requires matching Docs samples; it does not replace Docs content.",
						);
					}
					const disk = createFilesystemArtifactStore(
						join(repoRoot, "scripts/dev/product-data/fixtures/product-data"),
					);
					const source = {
						async read(key: string) {
							if (key.startsWith("campus-docs/rag/") || key.startsWith("notices/rag/")) {
								return disk.read(key);
							}
							return target.read(key);
						},
					};
					const candidate = await readProductSeedIndex(repoRoot);
					const dataset = {
						rows,
						collection: candidate.collection,
						docsEmbeddingSet: candidate.docsEmbeddingSet,
						noticeEmbeddingSet: candidate.noticeEmbeddingSet,
					};
					const docs = await prepareRetrieval(dataset, source, candidate);
					await applyPreparedRetrieval(dataset, docs, candidate);
				} else {
					if (!options.namespace) {
						throw new Error("Cluster initialization requires a namespace");
					}
					const remote = await connectProductCluster(options.context, options.namespace, signal);
					try {
						const prepared = await withRetrievalExportLock(remote.database, async () => {
							const dataset = await exportRetrievalData(remote.database);
							temp = await mkdtemp(join(tmpdir(), "campus-product-data-"));
							const candidate = await downloadProductIndex({
								collection: dataset.collection,
								path: join(temp, "points.ndjson"),
								request: remote.qdrantRequest,
								signal,
							});
							const docs = await prepareRetrieval(dataset, remote.objectStore, candidate);
							return { dataset, candidate, docs };
						});
						await applyPreparedRetrieval(prepared.dataset, prepared.docs, prepared.candidate);
					} finally {
						await remote.close();
					}
				}
			} finally {
				process.off("SIGINT", interrupt);
				process.off("SIGTERM", interrupt);
				try {
					await client.end();
				} finally {
					if (temp) {
						await rm(temp, { recursive: true, force: true });
					}
				}
			}
		},
	);
}

export async function diagnoseProductData(
	_repoRoot: string,
	profile: LocalDevProfile,
	full = false,
): Promise<{ state: "ready" | "missing" | "invalid"; reason?: string }> {
	const client = new Client({ connectionString: localDatabaseUrls(profile).owner });
	let temp: string | undefined;
	try {
		await client.connect();
		const diagnose = async (): Promise<{
			state: "ready" | "missing" | "invalid";
			reason?: string;
		}> => {
			const data = full
				? await exportRetrievalData(client)
				: {
						collection: (
							await client.query<{ collection: string }>(
								"select collection from campus_docs_serving.current_index where singleton = true",
							)
						).rows[0]?.collection,
						rows: undefined,
					};
			if (!data.collection) {
				return { state: "missing", reason: "Product data has no current index" };
			}
			const store = createS3WriterStore(localProductStoreEnv(_repoRoot, profile));
			if (!(full || (await store.readIfExists(PRODUCT_DOCS_SOURCE_KEY)))) {
				return { state: "missing", reason: "Local Docs source is missing" };
			}
			const qdrant = await resolveLocalQdrantConnection(_repoRoot, profile);
			const request = async (path: string, body?: unknown) => {
				const response = await fetch(`${qdrant.url}${path}`, {
					method: body === undefined ? "GET" : "POST",
					headers: { "api-key": qdrant.readOnlyApiKey, "content-type": "application/json" },
					body: body === undefined ? undefined : JSON.stringify(body),
					signal: AbortSignal.timeout(30_000),
				});
				if (!response.ok) {
					throw new Error(`Local index returned HTTP ${response.status}`);
				}
				return response.json();
			};
			if (full && data.rows) {
				const rows = data.rows;
				const docs = await copyDocsClosure(store);
				await copyNoticeAssets(rows, store);
				temp = await mkdtemp(join(tmpdir(), "campus-product-doctor-"));
				await downloadProductIndex({
					collection: data.collection,
					path: join(temp, "points.ndjson"),
					request,
					validatePoint: (point) => validateProductPoint(point, rows, docs.references),
				});
			} else {
				await request(`/collections/${data.collection}`);
			}
			return { state: "ready" };
		};
		return full ? await withRetrievalExportLock(client, diagnose) : await diagnose();
	} catch (error) {
		return { state: "invalid", reason: error instanceof Error ? error.message : String(error) };
	} finally {
		await client.end().catch(() => undefined);
		if (temp) {
			await rm(temp, { recursive: true, force: true });
		}
	}
}
