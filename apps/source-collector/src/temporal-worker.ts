import { startNodeTelemetry } from "@campus-agent/telemetry-node";
import { OpenTelemetryPlugin } from "@temporalio/interceptors-opentelemetry-v2";
import { NativeConnection, Worker } from "@temporalio/worker";
import { createSourceCollectorActivities } from "./activities.ts";
import { createSourceCollectorObjectStoreFromEnv } from "./object-store.ts";
import { resolveWorkerDeploymentOptions } from "./worker-versioning.ts";

const DEFAULT_TASK_QUEUE = "campus-agent.ingestion.activity.source-collector";

export async function startSourceCollectorTemporalWorker(
	env: Record<string, string | undefined> = process.env,
): Promise<void> {
	const address = requiredEnv(env, "INGESTION_TEMPORAL_ADDRESS");
	const objectStore = createSourceCollectorObjectStoreFromEnv(env);
	const telemetry = startNodeTelemetry({ env, serviceName: "source-collector-worker" });
	let connection: NativeConnection | null = null;
	try {
		connection = await NativeConnection.connect({ address });
		const worker = await Worker.create({
			activities: createSourceCollectorActivities({ env, objectStore }),
			connection,
			maxConcurrentActivityTaskExecutions: 1,
			namespace: env.INGESTION_TEMPORAL_NAMESPACE?.trim() || "default",
			plugins: telemetry.spanProcessor
				? [
						new OpenTelemetryPlugin({
							resource: telemetry.resource,
							spanProcessor: telemetry.spanProcessor,
						}),
					]
				: [],
			shutdownGraceTime: "80 seconds",
			taskQueue:
				env.INGESTION_TEMPORAL_SOURCE_COLLECTOR_ACTIVITY_TASK_QUEUE?.trim() || DEFAULT_TASK_QUEUE,
			workerDeploymentOptions: resolveWorkerDeploymentOptions(env),
		});
		await worker.run();
	} finally {
		try {
			await connection?.close();
		} finally {
			try {
				await objectStore.close?.();
			} finally {
				await telemetry.shutdown();
			}
		}
	}
}

function requiredEnv(env: Record<string, string | undefined>, key: string): string {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`${key} is required`);
	}
	return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	startSourceCollectorTemporalWorker().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
