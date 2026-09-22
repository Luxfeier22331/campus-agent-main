import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Client } from "pg";
import { createS3ObjectStore } from "../../apps/campus-web/src/docs-reader-build/published-reader-object-store.ts";
import { createFilesystemArtifactStore } from "../../jobs/campus-docs-index-publisher/src/filesystem-artifact-store.ts";
import { importCampusRagArtifacts } from "../../jobs/campus-rag-index-publisher/src/artifact-import.ts";
import { createPostgresIndexCatalog } from "../../jobs/campus-rag-index-publisher/src/catalog.ts";
import { createS3WriterStore } from "../../jobs/campus-rag-index-publisher/src/object-store.ts";
import { materializeCollection } from "../../jobs/campus-rag-index-publisher/src/publisher.ts";
import { createQdrantClient } from "../../jobs/campus-rag-index-publisher/src/qdrant.ts";
import { localDatabaseUrls } from "./environment.ts";
import { resolveLocalQdrantConnection } from "./local-qdrant.ts";
import { withLifecycleLock } from "./locks.ts";
import { probeLocalPorts } from "./ports.ts";
import { runCommand } from "./process.ts";
import { connectProductCluster } from "./product-data-cluster.ts";
import { exportProductData, hasProductData, importProductData } from "./product-data-database.ts";
import { downloadProductIndex } from "./product-data-index.ts";
import type { ProductDataOptions } from "./product-data-options.ts";
import {
	copyDocsClosure,
	copyProductAssets,
	PRODUCT_DOCS_SOURCE_KEY,
	validateProductPoint,
} from "./product-data-resources.ts";
import { createProductSeed } from "./product-data-seed.ts";
import { readProductSeedIndex } from "./product-data-seed-index.ts";
import { clearProductSyncPending, readPendingProductSync } from "./product-data-state.ts";
import {
	calculateLocalDevRuntimePorts,
	type LocalDevProfileV2,
	resolveLocalDevRegistryPath,
} from "./profile.ts";

export function localProductStoreEnv(profile: LocalDevProfileV2) {
	return {
		OBJECT_STORE_BUCKET_DERIVED: profile.bucketName,
		OBJECT_STORE_ENDPOINT: "http://127.0.0.1:9000",
		OBJECT_STORE_DERIVED_ACCESS_KEY: "rustfsadmin",
		OBJECT_STORE_DERIVED_SECRET_KEY: "rustfsadmin",
		OBJECT_STORE_DERIVED_READ_ACCESS_KEY: "rustfsadmin",
		OBJECT_STORE_DERIVED_READ_SECRET_KEY: "rustfsadmin",
	};
}

export async function repairProductSnapshot(
	repoRoot: string,
	profile: LocalDevProfileV2,
	_alreadyLocked = false,
): Promise<void> {
	await assertProductAppsOffline(profile);
	const repair = async () => {
		const pending = readPendingProductSync(repoRoot);
		if (pending) {
			const store = createS3WriterStore(localProductStoreEnv(profile));
			try {
				for (const key of pending.createdKeys) {
					await store.remove(key);
				}
			} finally {
				store.close();
			}
		}
		clearProductSyncPending(repoRoot);
	};
	if (_alreadyLocked) {
		return repair();
	}
	await withLifecycleLock(
		resolve(dirname(resolveLocalDevRegistryPath(repoRoot)), `${profile.instanceId}-data.lock`),
		"product-repair",
		repair,
	);
}

export async function assertProductAppsOffline(profile: LocalDevProfileV2) {
	const ports = [
		...Object.values(profile.ports),
		...Object.values(calculateLocalDevRuntimePorts(profile.slot)),
	];
	const result = await probeLocalPorts(ports);
	if (result.occupied.length > 0 || result.unknown.length > 0) {
		throw new Error(
			`Stop current worktree applications before initializing data; ports: ${[...result.occupied, ...result.unknown].join(", ")}. Shared infrastructure stays running.`,
		);
	}
}

export async function initializeProductData(
	repoRoot: string,
	profile: LocalDevProfileV2,
	options: ProductDataOptions,
) {
	await assertProductAppsOffline(profile);
	const registry = dirname(resolveLocalDevRegistryPath(repoRoot));
	return withLifecycleLock(
		resolve(registry, `${profile.instanceId}-data.lock`),
		"product-data",
		async () => {
			const client = new Client({ connectionString: localDatabaseUrls(profile).owner });
			const env = localProductStoreEnv(profile);
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
				temp = await mkdtemp(join(tmpdir(), "campus-product-data-"));
				const existing =
					(await hasProductData(client)) ||
					(await target.readIfExists(PRODUCT_DOCS_SOURCE_KEY)) !== undefined;
				if (existing && !options.replace) {
					if (options.data === "cluster") {
						throw new Error("Local product data exists; cluster pull requires --replace");
					}
					if (!(await target.readIfExists(PRODUCT_DOCS_SOURCE_KEY))) {
						const legacy = createS3WriterStore({
							...env,
							OBJECT_STORE_BUCKET_DERIVED: "campus-agent-derived",
						});
						if (await legacy.readIfExists(PRODUCT_DOCS_SOURCE_KEY)) {
							const copied = await copyDocsClosure(legacy, target);
							await createS3ObjectStore(env).writeBytesObject({
								key: PRODUCT_DOCS_SOURCE_KEY,
								body: copied.sourceBytes,
								contentType: "application/json",
							});
						}
					}
					const diagnosis = await diagnoseProductData(repoRoot, profile, true);
					if (diagnosis.state !== "ready") {
						throw new Error(
							`Existing product data is incomplete; preserved without seed mixing. Use --replace: ${diagnosis.reason}`,
						);
					}
					return;
				}
				const qdrant = await resolveLocalQdrantConnection();
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
												signal: AbortSignal.any([publishSignal, AbortSignal.timeout(30_000)]),
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
				if (options.data === "seed") {
					const seed = createProductSeed(new Date());
					const source = {
						async read(key: string) {
							signal.throwIfAborted();
							const object = seed.objects.get(key);
							if (!object) {
								return createFilesystemArtifactStore(
									join(repoRoot, "scripts/dev/fixtures/product-data"),
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
					if (!(options.context && options.namespace)) {
						throw new Error("Cluster initialization requires explicit context and namespace");
					}
					const remote = await connectProductCluster(options.context, options.namespace, signal);
					try {
						const dataset = await exportProductData(remote.database);
						const stagingDirectory = temp;
						const stagedFiles = new Map<string, string>();
						const stagedSource = {
							async read(key: string) {
								signal.throwIfAborted();
								const existing = stagedFiles.get(key);
								if (existing) {
									return readFile(existing);
								}
								const bytes = await remote.objectStore.read(key);
								const path = join(stagingDirectory, `object-${stagedFiles.size}`);
								await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
								stagedFiles.set(key, path);
								return bytes;
							},
						};
						const docs = await copyDocsClosure(stagedSource);
						const candidate = await downloadProductIndex({
							collection: dataset.collection,
							path: join(temp, "points.ndjson"),
							request: remote.qdrantRequest,
							validatePoint: (point) => validateProductPoint(point, dataset.rows, docs.references),
						});
						await prepareAndApply(dataset, stagedSource, candidate);
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
			const result = await diagnoseProductData(repoRoot, profile, true);
			if (result.state !== "ready") {
				throw new Error(`Product data initialization is incomplete: ${result.reason}`);
			}
		},
	);
}

export async function diagnoseProductData(
	_repoRoot: string,
	profile: LocalDevProfileV2,
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
			throw new Error("Product data has no current index");
		}
		for (const table of [
			"notices.notices",
			"campus_groups.groups",
			"transport.routes",
			"dining.map_publication",
		] as const) {
			if ((await client.query(`select 1 from ${table} limit 1`)).rows.length === 0) {
				throw new Error(`Missing product data: ${table}`);
			}
		}
		const store = createS3WriterStore(localProductStoreEnv(profile));
		if (!(await store.readIfExists(PRODUCT_DOCS_SOURCE_KEY))) {
			throw new Error("Local Docs source is missing");
		}
		const qdrant = await resolveLocalQdrantConnection();
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
		await request(`/collections/${data.collection}`);
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
