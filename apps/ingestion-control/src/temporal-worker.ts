import { fileURLToPath } from "node:url";
import { startNodeTelemetry } from "@campus-agent/telemetry-node";
import { OpenTelemetryPlugin } from "@temporalio/interceptors-opentelemetry-v2";
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
	assertIngestionControlPostgresSchema,
	createPostgresIngestionTaskStore,
} from "./postgres-store";
import { INGESTION_KERNEL_TOKENIZER_JSON_PATH } from "./runtime-paths";
import { createDefaultRustKernelRegistry } from "./rust-kernel-runner";
import { assertRustKernelRegistryCoversTasks } from "./task-executor";
import { buildIngestionTemporalConfig } from "./temporal-config";
import { buildIngestionTemporalWorkerRuntimeConfig } from "./temporal-worker-config";

const WORKER_DATABASE_CONNECTION_TIMEOUT_MS = 10_000;
const WORKER_DATABASE_QUERY_TIMEOUT_MS = 4 * 60_000;

export async function startIngestionTemporalWorkers(
	env: Record<string, string | undefined> = process.env,
): Promise<void> {
	const runtimeConfig = buildIngestionTemporalWorkerRuntimeConfig(env);
	const temporalConfig = buildIngestionTemporalConfig(env);
	const telemetry = startNodeTelemetry({ env, serviceName: "ingestion-control-worker" });
	const { Pool } = await import("pg");
	const pool = new Pool({
		...runtimeConfig.database,
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
			tokenizerJsonPath: INGESTION_KERNEL_TOKENIZER_JSON_PATH,
		});
		assertRustKernelRegistryCoversTasks(registryCatalog.registeredTasks(), rustKernels);
		connection = await NativeConnection.connect({ address: temporalConfig.address });
		const common = {
			connection,
			namespace: temporalConfig.namespace,
			plugins: telemetry.spanProcessor
				? [
						new OpenTelemetryPlugin({
							resource: telemetry.resource,
							spanProcessor: telemetry.spanProcessor,
						}),
					]
				: [],
			shutdownGraceTime: "50 seconds" as const,
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
			activities: {
				...createIngestionProjectionActivities({
					objectStore,
					store: createPostgresIngestionTaskStore({ pool }),
				}),
			},
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
				try {
					await objectStore.close?.();
				} finally {
					await telemetry.shutdown();
				}
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
