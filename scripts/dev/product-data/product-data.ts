import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Client } from "pg";
import { createS3ObjectStore } from "../../../apps/campus-web/src/docs-reader-build/published-reader-object-store.ts";
import { createFilesystemArtifactStore } from "../../../jobs/campus-docs-index-publisher/src/filesystem-artifact-store.ts";
import { importCampusRagArtifacts } from "../../../jobs/campus-rag-index-publisher/src/artifact-import.ts";
import { createPostgresIndexCatalog } from "../../../jobs/campus-rag-index-publisher/src/catalog.ts";
import { createS3WriterStore } from "../../../jobs/campus-rag-index-publisher/src/object-store.ts";
import { materializeCollection } from "../../../jobs/campus-rag-index-publisher/src/publisher.ts";
import { createQdrantClient } from "../../../jobs/campus-rag-index-publisher/src/qdrant.ts";
import { localDatabaseUrls } from "../lifecycle/environment.ts";
import { loadLocalInfrastructureSecrets } from "../lifecycle/infrastructure-secrets.ts";
import { resolveLocalQdrantConnection } from "../lifecycle/local-qdrant.ts";
import { withLifecycleLock } from "../lifecycle/locks.ts";
import { probeLocalPorts } from "../lifecycle/ports.ts";
import { runCommand } from "../lifecycle/process.ts";
import {
	calculateLocalDevInfrastructurePorts,
	calculateLocalDevRuntimePorts,
	type LocalDevProfile,
	resolveLocalDevRegistryPath,
} from "../lifecycle/profile.ts";
import { connectProductCluster, connectProductContentCluster } from "./product-data-cluster.ts";
import { copyNoticeSources, exportProductContent } from "./product-data-content.ts";
import {
	exportProductData,
	exportRetrievalData,
	hasProductData,
	hasRetrievalData,
	importProductContent,
	importProductData,
	importRetrievalData,
} from "./product-data-database.ts";
import { downloadProductIndex } from "./product-data-index.ts";
import type { ProductDataOptions } from "./product-data-options.ts";
import {
	copyDocsClosure,
	copyNoticeAssets,
	copyProductAssets,
	PRODUCT_DOCS_SOURCE_KEY,
	validateProductPoint,
} from "./product-data-resources.ts";
import { createProductSeed } from "./product-data-seed.ts";
import { readProductSeedIndex } from "./product-data-seed-index.ts";

export function localProductStoreEnv(repoRoot: string, profile: LocalDevProfile) {
	const ports = profile.infraPorts ?? calculateLocalDevInfrastructurePorts(profile.slot);
	const secrets = loadLocalInfrastructureSecrets(repoRoot, profile);
	const accessKey = secrets.objectStoreAccessKey;
	const secretKey = secrets.objectStoreSecretKey;
	return {
		OBJECT_STORE_BUCKET_DERIVED: profile.bucketName,
		OBJECT_STORE_ENDPOINT: `http://127.0.0.1:${ports.objectStore}`,
		OBJECT_STORE_DERIVED_ACCESS_KEY: accessKey,
		OBJECT_STORE_DERIVED_SECRET_KEY: secretKey,
		OBJECT_STORE_DERIVED_READ_ACCESS_KEY: accessKey,
		OBJECT_STORE_DERIVED_READ_SECRET_KEY: secretKey,
	};
}

export async function assertProductAppsOffline(profile: LocalDevProfile) {
	const ports = [
		...Object.values(profile.ports),
		...Object.values(calculateLocalDevRuntimePorts(profile.slot)),
	];
	const result = await probeLocalPorts(ports);
	if (result.occupied.length > 0 || result.unknown.length > 0) {
		throw new Error(
			`Stop current worktree applications before initializing data; ports: ${[...result.occupied, ...result.unknown].join(", ")}. Current worktree infrastructure stays running.`,
		);
	}
}

export async function initializeProductData(
	repoRoot: string,
	profile: LocalDevProfile,
	options: ProductDataOptions,
) {
	await assertProductAppsOffline(profile);
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
			const interrupt = () => {
				process.exitCode = 130;
				controller.abort(new Error("Product data initialization interrupted"));
			};
			process.once("SIGINT", interrupt);
			process.once("SIGTERM", interrupt);
			const signal = controller.signal;
			try {
				await client.connect();
				if (options.data === "cluster-content") {
					if (!options.namespace) {
						throw new Error("Cluster content import requires a namespace");
					}
					if (!options.replace && (await hasProductData(client))) {
						throw new Error("Local product data exists; use --replace to replace local content");
					}
					const remote = await connectProductContentCluster(
						options.context,
						options.namespace,
						signal,
					);
					try {
						const rows = await exportProductContent(remote.database, options.noticeLimit ?? 100);
						const sourceTarget = createS3ObjectStore({
							...env,
							OBJECT_STORE_BUCKET_DERIVED: profile.sourceBucketName,
						});
						const sourceBytes = await copyNoticeSources(
							rows,
							remote.sourceStore,
							async (key, body) => {
								signal.throwIfAborted();
								await sourceTarget.writeBytesObject({ key, body, contentType: "application/json" });
							},
						);
						signal.throwIfAborted();
						await importProductContent(client, { rows, replace: options.replace });
						console.log(
							JSON.stringify({
								mode: "cluster-content",
								rows: Object.fromEntries(
									Object.entries(rows).map(([table, values]) => [table, values.length]),
								),
								sourceBytes,
							}),
						);
					} finally {
						await remote.close();
					}
					return;
				}
				const existing =
					(options.data === "cluster"
						? await hasRetrievalData(client)
						: await hasProductData(client)) ||
					(await target.readIfExists(PRODUCT_DOCS_SOURCE_KEY)) !== undefined;
				if (existing && !options.replace && options.data !== "cluster") {
					const diagnosis = await diagnoseProductData(repoRoot, profile);
					if (diagnosis.state !== "ready") {
						throw new Error(
							`Existing product data was preserved; required entry check failed: ${diagnosis.reason}. Fix the reported cause, or use --replace to intentionally replace local data.`,
						);
					}
					return;
				}
				const qdrant = await resolveLocalQdrantConnection(repoRoot, profile);
				const prepareAndApply = async (
					dataset: Awaited<ReturnType<typeof exportProductData>>,
					source: Parameters<typeof copyDocsClosure>[0],
					candidate: Parameters<typeof materializeCollection>[1],
					localReviews?: Record<string, unknown>[],
				) => {
					await importCampusRagArtifacts({
						docsEmbeddingSet: dataset.docsEmbeddingSet,
						noticeEmbeddingSet: dataset.noticeEmbeddingSet,
						sourceStore: source,
						targetStore: target,
					});
					const docs = await copyDocsClosure(source, target);
					await copyProductAssets(dataset.rows, source, target);
					const points =
						typeof candidate.points === "function" ? candidate.points() : candidate.points;
					for await (const point of points) {
						validateProductPoint(point, dataset.rows, docs.references);
					}
					await withLifecycleLock(
						resolve(registry, "qdrant-materialize.lock"),
						"product-data-index",
						async () => {
							const catalog = createPostgresIndexCatalog({
								EXECUTION_CONTROL_DATABASE_URL: localDatabaseUrls(profile).owner,
							});
							try {
								await catalog.acquirePublisherLock();
								const publishSignal = AbortSignal.any([signal, catalog.signal]);
								const registration = await catalog.register({
									collection: dataset.collection,
									docsEmbeddingSet: dataset.docsEmbeddingSet,
									noticeEmbeddingSet: dataset.noticeEmbeddingSet,
									producer: "manual",
								});
								const qdrantClient = createQdrantClient({
									QDRANT_URL: qdrant.url,
									QDRANT_API_KEY: qdrant.apiKey,
								});
								if (
									registration.rebuildIncomplete &&
									(await qdrantClient.collectionExists(dataset.collection))
								) {
									await qdrantClient.deleteCollection(dataset.collection);
								}
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
								await importProductData(client, {
									...dataset,
									replace: options.replace,
									localReviews,
								});
							} finally {
								await catalog.close();
							}
						},
					);
					await createS3ObjectStore(env).writeBytesObject({
						key: PRODUCT_DOCS_SOURCE_KEY,
						body: docs.sourceBytes,
						contentType: "application/json",
					});
					runCommand("pnpm", ["exec", "tsx", "scripts/prepare-docs-content.ts", "--refresh"], {
						cwd: resolve(repoRoot, "apps/campus-web"),
						env: { ...process.env, ...env },
						timeout: 120_000,
					});
				};
				const prepareAndApplyRetrieval = async (
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
					await withLifecycleLock(
						resolve(registry, "qdrant-materialize.lock"),
						"product-data-index",
						async () => {
							const catalog = createPostgresIndexCatalog({
								EXECUTION_CONTROL_DATABASE_URL: localDatabaseUrls(profile).owner,
							});
							try {
								await catalog.acquirePublisherLock();
								const publishSignal = AbortSignal.any([signal, catalog.signal]);
								const registration = await catalog.register({
									collection: dataset.collection,
									docsEmbeddingSet: dataset.docsEmbeddingSet,
									noticeEmbeddingSet: dataset.noticeEmbeddingSet,
									producer: "manual",
								});
								const qdrantClient = createQdrantClient({
									QDRANT_URL: qdrant.url,
									QDRANT_API_KEY: qdrant.apiKey,
								});
								if (
									registration.rebuildIncomplete &&
									(await qdrantClient.collectionExists(dataset.collection))
								) {
									await qdrantClient.deleteCollection(dataset.collection);
								}
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
								await importRetrievalData(client, dataset);
							} finally {
								await catalog.close();
							}
						},
					);
				};
				if (options.data === "seed") {
					const seed = createProductSeed(new Date());
					const source = {
						async read(key: string) {
							signal.throwIfAborted();
							const object = seed.objects.get(key);
							if (!object) {
								return createFilesystemArtifactStore(
									join(repoRoot, "scripts/dev/product-data/fixtures/product-data"),
								).read(key);
							}
							return object.body;
						},
					};
					const candidate = await readProductSeedIndex(repoRoot);
					await prepareAndApply(
						{
							rows: seed.rows,
							collection: candidate.collection,
							docsEmbeddingSet: candidate.docsEmbeddingSet,
							noticeEmbeddingSet: candidate.noticeEmbeddingSet,
						},
						source,
						candidate,
						seed.reviews,
					);
				} else {
					if (!options.namespace) {
						throw new Error("Cluster initialization requires a namespace");
					}
					const remote = await connectProductCluster(options.context, options.namespace, signal);
					try {
						const dataset = await exportRetrievalData(remote.database);
						temp = await mkdtemp(join(tmpdir(), "campus-product-data-"));
						const candidate = await downloadProductIndex({
							collection: dataset.collection,
							path: join(temp, "points.ndjson"),
							request: remote.qdrantRequest,
							signal,
						});
						await prepareAndApplyRetrieval(dataset, remote.objectStore, candidate);
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
		const data = full
			? await exportProductData(client)
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
			await copyProductAssets(rows, store);
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
	} catch (error) {
		return { state: "invalid", reason: error instanceof Error ? error.message : String(error) };
	} finally {
		await client.end().catch(() => undefined);
		if (temp) {
			await rm(temp, { recursive: true, force: true });
		}
	}
}
