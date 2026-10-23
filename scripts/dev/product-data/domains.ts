import { dirname, resolve } from "node:path";
import { Client } from "pg";
import { createS3ObjectStore } from "../../../apps/campus-web/src/docs-reader-build/published-reader-object-store.ts";
import { createS3WriterStore } from "../../../jobs/retrieval-index/src/object-store.ts";
import type { BootstrapProbeResult } from "../lifecycle/application-bootstrap.ts";
import { localDatabaseUrls } from "../lifecycle/environment.ts";
import { withLifecycleLock } from "../lifecycle/locks.ts";
import { probeLocalPorts } from "../lifecycle/ports.ts";
import { runCommand } from "../lifecycle/process.ts";
import { type LocalDevProfile, resolveLocalDevRegistryPath } from "../lifecycle/profile.ts";
import { localProductStoreEnv } from "./connections.ts";
import {
	applyDomainRows,
	BUSINESS_DOMAINS,
	type BusinessDomain,
	domainHasData,
	readDomainRows,
} from "./domain-database.ts";
import { syncNotices } from "./notice-sync-cli.ts";
import { copyNoticeSourceClosure } from "./notice-sync-objects.ts";
import { diagnoseProductData, initializeRetrievalData } from "./product-data.ts";
import { connectProductObjects } from "./product-data-cluster.ts";
import { connectProductDatabase } from "./product-data-cluster-database.ts";
import { DEFAULT_CLUSTER_NAMESPACE } from "./product-data-options.ts";
import {
	copyDocsClosure,
	copyProductAssets,
	PRODUCT_DOCS_SOURCE_KEY,
} from "./product-data-resources.ts";
import { createProductSeed } from "./product-data-seed.ts";

export const DATA_DOMAINS = [...BUSINESS_DOMAINS, "docs", "retrieval"] as const;
export type DataDomain = (typeof DATA_DOMAINS)[number];
export interface DomainOptions {
	operation: "seed" | "sync";
	domains: DataDomain[];
	replace: boolean;
	context?: string;
	namespace?: string;
	noticeArgs?: string[];
}
export async function runDataOperation(
	repoRoot: string,
	profile: LocalDevProfile,
	input: DomainOptions,
) {
	const controller = new AbortController();
	const interrupt = () => {
		process.exitCode = 130;
		controller.abort(new Error("Domain data operation interrupted"));
	};
	process.once("SIGINT", interrupt);
	process.once("SIGTERM", interrupt);
	try {
		return await applyDataOperation(repoRoot, profile, input, controller);
	} finally {
		process.off("SIGINT", interrupt);
		process.off("SIGTERM", interrupt);
	}
}
async function applyDataOperation(
	repoRoot: string,
	profile: LocalDevProfile,
	input: DomainOptions,
	controller: AbortController,
) {
	const signal = controller.signal;
	let options = input;
	if (options.domains.length === 0) {
		throw new Error("Select --domain.");
	}
	if (
		options.operation === "sync" &&
		options.domains.includes("retrieval") &&
		options.domains.length !== 1
	) {
		throw new Error(
			"Retrieval sync already includes its notice and Docs references; select it independently.",
		);
	}
	const namespace = options.namespace ?? DEFAULT_CLUSTER_NAMESPACE;
	if (options.operation === "sync" && options.domains.includes("notices") && !options.replace) {
		await syncNotices(
			[
				...(options.context ? ["--context", options.context] : []),
				"--namespace",
				namespace,
				...(options.noticeArgs ?? []),
			],
			repoRoot,
		);
		options = { ...options, domains: options.domains.filter((domain) => domain !== "notices") };
		if (options.domains.length === 0) {
			return;
		}
	}

	if (options.replace) {
		const ports = [
			profile.ports.appApi,
			profile.ports.opsWebApi,
			...(options.domains.includes("docs") ? [profile.ports.campusWeb] : []),
		];
		const status = await probeLocalPorts(ports);
		if (status.occupied.length > 0 || status.unknown.length > 0) {
			throw new Error(
				`Stop affected data consumers before replacement: ${[...status.occupied, ...status.unknown].join(", ")}`,
			);
		}
	}
	const business = options.domains.filter((d): d is BusinessDomain =>
		BUSINESS_DOMAINS.includes(d as BusinessDomain),
	);
	if (business.length > 0 || options.domains.includes("docs")) {
		const lock = resolve(
			dirname(resolveLocalDevRegistryPath(repoRoot)),
			`${profile.instanceId}-data.lock`,
		);
		await withLifecycleLock(lock, "domain-data", async () => {
			signal.throwIfAborted();
			const client = new Client({ connectionString: localDatabaseUrls(profile).owner });
			const cancel = () => {
				void client.end().catch(() => undefined);
			};
			client.on("error", (error) => controller.abort(error));
			signal.addEventListener("abort", cancel, { once: true });
			try {
				await client.connect();
				const selected: BusinessDomain[] = [];
				for (const domain of business) {
					if (!options.replace && (await domainHasData(client, domain))) {
						console.log(JSON.stringify({ domain, status: "preserved" }));
					} else {
						selected.push(domain);
					}
				}
				const env = localProductStoreEnv(repoRoot, profile);
				const target = createS3WriterStore(env);
				const docsSelected =
					options.domains.includes("docs") &&
					(options.replace || (await target.readIfExists(PRODUCT_DOCS_SOURCE_KEY)) === undefined);
				if (options.domains.includes("docs") && !docsSelected) {
					console.log(JSON.stringify({ domain: "docs", status: "preserved" }));
				}
				if (options.operation === "seed") {
					const seed = createProductSeed(new Date());
					if (selected.includes("transport")) {
						const id = seed.rows["transport.schedule_period_notices"][0]?.notice_id;
						const exists =
							selected.includes("notices") ||
							(
								await client.query(
									"select 1 from notices.notices where notice_id = $1 and title = $2",
									[id, seed.rows["notices.notices"].find((n) => n.notice_id === id)?.title],
								)
							).rows.length > 0;
						if (!exists) {
							seed.rows["transport.schedule_period_notices"] = [];
						}
					}
					const source = {
						async read(key: string) {
							const object = seed.objects.get(key);
							if (!object) {
								throw new Error(`Missing seed object: ${key}`);
							}
							return object.body;
						},
					};
					const selectedRows = {
						...seed.rows,
						"notices.notice_assets": selected.includes("notices")
							? seed.rows["notices.notice_assets"]
							: [],
						"dining.map_releases": selected.includes("dining")
							? seed.rows["dining.map_releases"]
							: [],
					};
					await copyProductAssets(selectedRows, source, target);
					if (selected.includes("notices")) {
						const sourceTarget = createS3ObjectStore({
							...env,
							OBJECT_STORE_BUCKET_DERIVED: profile.sourceBucketName,
						});
						for (const [key, object] of seed.sourceObjects) {
							await sourceTarget.writeBytesObject({
								key,
								body: object.body,
								contentType: object.contentType,
							});
						}
					}
					signal.throwIfAborted();
					const applied = await applyDomainRows(
						client,
						selected,
						seed.rows,
						options.replace,
						seed.reviews,
					);
					for (const domain of applied) {
						console.log(JSON.stringify({ domain, status: "initialized" }));
					}
					if (docsSelected) {
						await writeDocs(source);
					}
				} else {
					if (selected.length > 0) {
						const remote = await connectProductDatabase(options.context, namespace, signal);
						try {
							const rows = await readDomainRows(remote.database, selected);
							if (selected.includes("notices")) {
								const withSources = options.noticeArgs?.includes("--with-sources");
								if (withSources) {
									const objects = await connectProductObjects(
										options.context,
										namespace,
										"source",
										signal,
									);
									try {
										const sourceTarget = createS3ObjectStore({
											...env,
											OBJECT_STORE_BUCKET_DERIVED: profile.sourceBucketName,
										});
										await copyNoticeSourceClosure({
											rows,
											read: (key) => objects.store.read(key),
											write: async (key, body, contentType) => {
												await sourceTarget.writeBytesObject({ key, body, contentType });
											},
										});
									} finally {
										await objects.close();
									}
								} else {
									rows["notices.notice_assets"] = [];
									rows["notices.notices"] = rows["notices.notices"].map((row) => ({
										...row,
										source_ref: null,
										published_source_ref: null,
									}));
								}
							}
							if (
								selected.includes("dining") ||
								(selected.includes("notices") && options.noticeArgs?.includes("--with-sources"))
							) {
								const objects = await connectProductObjects(
									options.context,
									namespace,
									"derived",
									signal,
								);
								try {
									await copyProductAssets(rows, objects.store, target);
								} finally {
									await objects.close();
								}
							}
							signal.throwIfAborted();
							await applyDomainRows(client, selected, rows, options.replace);
							for (const domain of selected) {
								console.log(JSON.stringify({ domain, status: "synced" }));
							}
						} finally {
							await remote.close();
						}
					}
					if (docsSelected) {
						const remote = await connectProductObjects(
							options.context,
							namespace,
							"derived",
							signal,
						);
						try {
							await writeDocs(remote.store);
						} finally {
							await remote.close();
						}
					}
				}
				async function writeDocs(source: Parameters<typeof copyDocsClosure>[0]) {
					const docs = await copyDocsClosure(source, target);
					signal.throwIfAborted();
					if (options.replace) {
						await client.query("delete from campus_docs_serving.current_index");
					}
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
					console.log(
						JSON.stringify({
							domain: "docs",
							status: options.operation === "seed" ? "initialized" : "synced",
						}),
					);
				}
			} finally {
				signal.removeEventListener("abort", cancel);
				await client.end();
			}
		});
	}
	if (options.domains.includes("retrieval")) {
		signal.throwIfAborted();
		await initializeRetrievalData(repoRoot, profile, {
			data: options.operation === "seed" ? "seed" : "cluster",
			replace: options.replace,
			context: options.context,
			namespace: options.namespace,
		});
	}
}
export async function diagnoseDomains(
	repoRoot: string,
	profile: LocalDevProfile,
	domains: readonly DataDomain[],
): Promise<Record<string, BootstrapProbeResult>> {
	const checks: Record<string, BootstrapProbeResult> = {};
	for (const domain of domains) {
		if (domain === "retrieval") {
			checks[domain] = await diagnoseProductData(repoRoot, profile, true);
			continue;
		}
		const client = new Client({ connectionString: localDatabaseUrls(profile).owner });
		try {
			const store = createS3WriterStore(localProductStoreEnv(repoRoot, profile));
			if (domain === "docs") {
				await copyDocsClosure(store);
			} else {
				await client.connect();
				const rows = await readDomainRows(client, [domain]);
				await copyProductAssets(rows, store);
			}
			checks[domain] = { state: "ready" };
		} catch (e) {
			checks[domain] = { state: "invalid", reason: e instanceof Error ? e.message : String(e) };
		} finally {
			await client.end();
		}
	}
	return checks;
}
