import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import {
	loadCollectionChunkProfilesFromRoot,
	loadIngestionTaskRegistryCatalogFromRoot,
} from "ingest-core/node";
import { createIngestionProjectionActivities, createRustKernelActivities } from "./activities";
import {
	createS3IngestionObjectStoreFromEnv,
	type IngestionObjectStore,
	type IngestionObjectStoreEnvironment,
} from "./object-store";
import {
	createOfficialWebFreshnessService,
	createPostgresOfficialWebFreshnessStore,
} from "./official-web-freshness";
import {
	assertIngestionControlPostgresSchema,
	createPostgresIngestionTaskStore,
} from "./postgres-store";
import { buildIngestionControlRuntimeConfig } from "./runtime";
import { createDefaultRustKernelRegistry } from "./rust-kernel-runner";
import { assertRustKernelRegistryCoversTasks } from "./task-executor";
import { buildIngestionTemporalConfig } from "./temporal-config";
import { resolveWorkerDeploymentOptions } from "./worker-versioning";

const WORKER_DATABASE_CONNECTION_TIMEOUT_MS = 10_000;
const WORKER_DATABASE_QUERY_TIMEOUT_MS = 4 * 60_000;

export async function startIngestionTemporalWorkers(
	env: Record<string, string | undefined> = process.env,
): Promise<void> {
	const runtimeConfig = buildIngestionControlRuntimeConfig(env);
	const temporalConfig = buildIngestionTemporalConfig(env);
	const { Pool } = await import("pg");
	const pool = new Pool({
		connectionString: runtimeConfig.databaseUrl,
		connectionTimeoutMillis: WORKER_DATABASE_CONNECTION_TIMEOUT_MS,
		query_timeout: WORKER_DATABASE_QUERY_TIMEOUT_MS,
		statement_timeout: WORKER_DATABASE_QUERY_TIMEOUT_MS,
	});
	const objectStore = requireTemporalWorkerObjectStore(env);
	let connection: NativeConnection | null = null;
	const workers: Worker[] = [];
	const runs: Promise<void>[] = [];
	try {
		await assertIngestionControlPostgresSchema(pool);
		const registryCatalog = loadIngestionTaskRegistryCatalogFromRoot(runtimeConfig.registryRoot);
		const rustKernels = createDefaultRustKernelRegistry({
			chunkProfiles: loadCollectionChunkProfilesFromRoot(runtimeConfig.registryRoot),
			objectStore,
			runnerPath: env.INGESTION_KERNEL_RUNNER_PATH,
			tokenizerJsonPath: env.INGESTION_KERNEL_TOKENIZER_JSON_PATH,
		});
		assertRustKernelRegistryCoversTasks(registryCatalog.registeredTasks(), rustKernels);
		connection = await NativeConnection.connect({ address: temporalConfig.address });
		const common = {
			connection,
			namespace: temporalConfig.namespace,
			shutdownGraceTime: "50 seconds" as const,
			workerDeploymentOptions: resolveWorkerDeploymentOptions(env),
		};
		await createAndRunWorker(workers, runs, {
			...common,
			maxConcurrentWorkflowTaskExecutions: 16,
			taskQueue: temporalConfig.workflowTaskQueue,
			workflowsPath: fileURLToPath(
				new URL("./workflows/ingestion-task-workflow.ts", import.meta.url),
			),
		});
		await createAndRunWorker(workers, runs, {
			...common,
			activities: createIngestionProjectionActivities({
				objectStore,
				officialWebFreshness: createOfficialWebFreshnessService({
					objectStore,
					store: createPostgresOfficialWebFreshnessStore({ pool }),
				}),
				store: createPostgresIngestionTaskStore({ pool }),
			}),
			maxConcurrentActivityTaskExecutions: 8,
			taskQueue: temporalConfig.controlActivityTaskQueue,
		});
		await createAndRunWorker(workers, runs, {
			...common,
			activities: createRustKernelActivities({ rustKernels }),
			maxConcurrentActivityTaskExecutions: 1,
			taskQueue: temporalConfig.rustKernelActivityTaskQueue,
		});
		await Promise.all(runs);
	} catch (error) {
		shutdownRunningWorkers(workers);
		await Promise.allSettled(runs);
		throw error;
	} finally {
		try {
			await connection?.close();
		} finally {
			try {
				await pool.end();
			} finally {
				await objectStore.close?.();
			}
		}
	}
}

async function createAndRunWorker(
	workers: Worker[],
	runs: Promise<void>[],
	options: Parameters<typeof Worker.create>[0],
): Promise<void> {
	const worker = await Worker.create(options);
	workers.push(worker);
	runs.push(worker.run());
}

function shutdownRunningWorkers(workers: Worker[]): void {
	for (const worker of workers) {
		if (worker.getState() === "RUNNING") {
			worker.shutdown();
		}
	}
}

export function requireTemporalWorkerObjectStore(
	env: IngestionObjectStoreEnvironment = process.env,
): IngestionObjectStore {
	const objectStore = createS3IngestionObjectStoreFromEnv(env);
	if (!objectStore) {
		throw new Error("ingestion Temporal worker requires source object store configuration");
	}
	return objectStore;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	startIngestionTemporalWorkers().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
