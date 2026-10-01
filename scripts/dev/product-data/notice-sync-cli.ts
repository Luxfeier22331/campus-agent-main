import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Client } from "pg";
import { localDatabaseUrls } from "../lifecycle/environment.ts";
import { withLifecycleLock } from "../lifecycle/locks.ts";
import { loadLocalDevProfile, resolveLocalDevRegistryPath } from "../lifecycle/profile.ts";
import { exportNoticeSources, importNoticeSources } from "./notice-sync.ts";
import { connectProductDatabase } from "./product-data-cluster-database.ts";
import { DEFAULT_CLUSTER_NAMESPACE } from "./product-data-options.ts";

async function main() {
	const args = process.argv.slice(2);
	const { values } = parseArgs({
		args: args[0] === "--" ? args.slice(1) : args,
		options: {
			context: { type: "string" },
			namespace: { type: "string", default: DEFAULT_CLUSTER_NAMESPACE },
		},
	});
	const repoRoot = resolve(import.meta.dirname, "../../..");
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
			const remote = await connectProductDatabase(values.context, namespace, controller.signal);
			const local = new Client({ connectionString: localDatabaseUrls(profile).owner });
			const cancelLocal = () => {
				void local.end().catch(() => undefined);
			};
			try {
				console.log(
					JSON.stringify({ event: "reading_notices", namespace, database: profile.databaseName }),
				);
				const rows = await exportNoticeSources(remote.database);
				await remote.close();
				controller.signal.throwIfAborted();
				console.log(
					JSON.stringify({ event: "importing_notices", count: rows["notices.notices"].length }),
				);
				await local.connect();
				controller.signal.addEventListener("abort", cancelLocal, { once: true });
				controller.signal.throwIfAborted();
				const result = await importNoticeSources(local, rows);
				console.log(
					JSON.stringify({ event: "result", database: profile.databaseName, ...result }, null, 2),
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

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode ||= 1;
});
