import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";

import { createIngestionTaskActivities } from "./activities";
import { loadAuthenticatedNoticeFamilyConfigFromRegistryRoot } from "./authenticated-notice-config";
import {
	createS3IngestionObjectStoreFromEnv,
	type IngestionObjectStore,
	type IngestionObjectStoreEnvironment,
} from "./object-store";
import { buildOfficialWebExecutionStatusService } from "./official-web-execution-status-service";
import {
	createPgOfficialWebProjectionStore,
	ensureOfficialWebPostgresSchema,
} from "./official-web-projection-store";
import {
	createPostgresIngestionTaskStore,
	ensureIngestionControlPostgresSchema,
} from "./postgres-store";
import { buildIngestionControlRuntimeConfig } from "./runtime";
import { createDefaultRustKernelRegistry } from "./rust-kernel-runner";
import {
	loadCollectionChunkProfilesFromRoot,
	loadIngestionTaskRegistryCatalogFromRoot,
} from "./task-registry";
import { buildIngestionTemporalConfig } from "./temporal-config";
import { createDefaultTsTaskHandlerRegistry } from "./ts-task-handlers";

export async function startIngestionTemporalWorkers(
	env: Record<string, string | undefined> = process.env,
): Promise<void> {
	const runtimeConfig = buildIngestionControlRuntimeConfig(env);
	const temporalConfig = buildIngestionTemporalConfig(env);
	const { Pool } = await import("pg");
	const pool = new Pool({ connectionString: runtimeConfig.databaseUrl });
	await ensureIngestionControlPostgresSchema(pool);
	await ensureOfficialWebPostgresSchema(pool);
	const objectStore = requireTemporalWorkerObjectStore(env);
	const store = createPostgresIngestionTaskStore({ pool });
	const officialWebProjectionStore = createPgOfficialWebProjectionStore({ pool });
	const registryCatalog = loadIngestionTaskRegistryCatalogFromRoot(runtimeConfig.registryRoot);
	const chunkProfiles = loadCollectionChunkProfilesFromRoot(runtimeConfig.registryRoot);
	const authenticatedNoticeFamilyConfig = loadAuthenticatedNoticeFamilyConfigFromRegistryRoot(
		runtimeConfig.registryRoot,
	);
	const connection = await NativeConnection.connect({ address: temporalConfig.address });
	const workflowWorker = await Worker.create({
		connection,
		namespace: temporalConfig.namespace,
		taskQueue: temporalConfig.workflowTaskQueue,
		workflowsPath: fileURLToPath(
			new URL("./workflows/ingestion-task-workflow.ts", import.meta.url),
		),
	});
	const controlActivityWorker = await Worker.create({
		activities: createIngestionTaskActivities({
			officialWebExecutionStatusService: buildOfficialWebExecutionStatusService({
				store: officialWebProjectionStore,
			}),
			registryCatalog,
			rustKernels: createDefaultRustKernelRegistry({ chunkProfiles, objectStore }),
			store,
			tsHandlers: createDefaultTsTaskHandlerRegistry({
				authenticatedNoticeFamilyConfig,
				authenticatedNoticeObjectStore: objectStore,
				officialWebObjectStore: objectStore,
				wechatOfficialAccountObjectStore: objectStore,
			}),
		}),
		connection,
		namespace: temporalConfig.namespace,
		taskQueue: temporalConfig.controlActivityTaskQueue,
	});

	const workflowRun = workflowWorker.run();
	const controlActivityRun = controlActivityWorker.run();
	try {
		await Promise.all([workflowRun, controlActivityRun]);
	} catch (error) {
		workflowWorker.shutdown();
		controlActivityWorker.shutdown();
		await Promise.allSettled([workflowRun, controlActivityRun]);
		throw error;
	} finally {
		await pool.end();
		await connection.close();
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
