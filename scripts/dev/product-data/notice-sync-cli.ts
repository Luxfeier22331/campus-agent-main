import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Client } from "pg";
import { createS3ObjectStore } from "../../../apps/campus-web/src/docs-reader-build/published-reader-object-store.ts";
import { localDatabaseUrls } from "../lifecycle/environment.ts";
import { withLifecycleLock } from "../lifecycle/locks.ts";
import { loadLocalDevProfile, resolveLocalDevRegistryPath } from "../lifecycle/profile.ts";
import { localProductStoreEnv, localSourceEndpoint } from "./connections.ts";
import { exportNoticeSources, importNoticeSources } from "./notice-sync.ts";
import { copyNoticeSourceClosure } from "./notice-sync-objects.ts";
import { parseNoticeSyncSelection } from "./notice-sync-options.ts";
import { connectProductContentCluster } from "./product-data-cluster.ts";
import { connectProductDatabase } from "./product-data-cluster-database.ts";
import { DEFAULT_CLUSTER_NAMESPACE } from "./product-data-options.ts";

export async function syncNotices(
	args: string[],
	repoRoot = resolve(import.meta.dirname, "../../.."),
) {
	const { values } = parseArgs({
		args: args[0] === "--" ? args.slice(1) : args,
		options: {
			context: { type: "string" },
			namespace: { type: "string", default: DEFAULT_CLUSTER_NAMESPACE },
			"released-from": { type: "string" },
			"released-to": { type: "string" },
			"with-sources": { type: "boolean", default: false },
		},
	});
	const selection = parseNoticeSyncSelection({
		releasedFrom: values["released-from"],
		releasedTo: values["released-to"],
	});
	const profile = loadLocalDevProfile(repoRoot);
	const namespace = values.namespace;
	if (!namespace.trim()) {
		throw new Error("Cluster namespace is required");
	}
	const lock = resolve(
		dirname(resolveLocalDevRegistryPath(repoRoot)),
		`${profile.instanceId}-data.lock`,
	);
	const controller = new AbortController();
	const interrupt = () => {
		process.exitCode = 130;
		controller.abort(new Error("Notice sync interrupted"));
	};
	process.once("SIGINT", interrupt);
	process.once("SIGTERM", interrupt);
	try {
		await withLifecycleLock(lock, "notice-sync", async () => {
			const remote = await (values["with-sources"]
				? connectProductContentCluster
				: connectProductDatabase)(values.context, namespace, controller.signal);
			const local = new Client({ connectionString: localDatabaseUrls(profile).owner });
			const cancelLocal = () => {
				void local.end().catch(() => undefined);
			};
			try {
				console.log(
					JSON.stringify({
						event: "reading_notices",
						namespace,
						database: profile.databaseName,
						selection,
					}),
				);
				const rows = await exportNoticeSources(remote.database, selection);
				if (values["with-sources"]) {
					const sourceRemote = remote as Awaited<ReturnType<typeof connectProductContentCluster>>;
					const target = createS3ObjectStore({
						...localProductStoreEnv(repoRoot, profile),
						OBJECT_STORE_BUCKET_DERIVED: profile.sourceBucketName,
					});
					const copied = await copyNoticeSourceClosure({
						rows,
						read: (key) => sourceRemote.sourceStore.read(key),
						write: async (key, body, contentType) => {
							controller.signal.throwIfAborted();
							await target.writeBytesObject({ key, body, contentType });
						},
						source: sourceRemote.sourceEndpoint,
						target: localSourceEndpoint(repoRoot, profile),
					});
					console.log(JSON.stringify({ event: "copied_notice_sources", ...copied }));
				}
				await remote.close();
				controller.signal.throwIfAborted();
				console.log(
					JSON.stringify({
						event: "importing_notices",
						count: rows["notices.notices"].length,
						selection,
					}),
				);
				await local.connect();
				controller.signal.addEventListener("abort", cancelLocal, { once: true });
				controller.signal.throwIfAborted();
				const result = await importNoticeSources(local, rows, {
					withSources: values["with-sources"],
				});
				console.log(
					JSON.stringify(
						{ event: "result", database: profile.databaseName, selection, ...result },
						null,
					),
				);
			} finally {
				controller.signal.removeEventListener("abort", cancelLocal);
				await local.end();
				await remote.close();
			}
		});
	} finally {
		process.removeListener("SIGINT", interrupt);
		process.removeListener("SIGTERM", interrupt);
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	syncNotices(process.argv.slice(2)).catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode ||= 1;
	});
}
