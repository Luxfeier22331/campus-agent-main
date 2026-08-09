import { NativeConnection, Worker } from "@temporalio/worker";
import { createSourceCollectorActivities } from "./activities.ts";
import { createSourceCollectorObjectStoreFromEnv } from "./object-store.ts";
import { safeSourceActivityFailureInterceptor } from "./temporal-activity-failure.ts";

const DEFAULT_TASK_QUEUE = "campus-agent.ingestion.activity.source-collector";

export async function startSourceCollectorTemporalWorker(
	env: Record<string, string | undefined> = process.env,
): Promise<void> {
	const address = requiredEnv(env, "INGESTION_TEMPORAL_ADDRESS");
	const objectStore = createSourceCollectorObjectStoreFromEnv(env);
	let connection: NativeConnection | null = null;
	try {
		connection = await NativeConnection.connect({ address });
		const worker = await Worker.create({
			activities: createSourceCollectorActivities({ env, objectStore }),
			connection,
			interceptors: { activity: [safeSourceActivityFailureInterceptor] },
			maxConcurrentActivityTaskExecutions: 1,
			namespace: env.INGESTION_TEMPORAL_NAMESPACE?.trim() || "default",
			shutdownGraceTime: "80 seconds",
			taskQueue: DEFAULT_TASK_QUEUE,
		});
		await worker.run();
	} finally {
		try {
			await connection?.close();
		} finally {
			await objectStore.close?.();
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
		console.error(
			JSON.stringify({
				error_code: safeWorkerErrorCode(error),
				event_type: "source_collector.worker_failed",
				level: "error",
				status: "failed",
			}),
		);
		process.exitCode = 1;
	});
}

function safeWorkerErrorCode(error: unknown): string {
	if (error && typeof error === "object") {
		const code = (error as { code?: unknown }).code;
		if (typeof code === "string" && /^[A-Za-z0-9_.:-]{1,80}$/u.test(code)) {
			return code;
		}
	}
	return "worker_failed";
}
