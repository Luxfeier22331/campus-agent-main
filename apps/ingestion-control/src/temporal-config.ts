export interface IngestionTemporalConfig {
	address: string;
	namespace: string;
	workflowTaskQueue: string;
	controlActivityTaskQueue: string;
	rustKernelActivityTaskQueue: string;
	sourceCollectorActivityTaskQueue: string;
}

export const DEFAULT_INGESTION_WORKFLOW_TASK_QUEUE = "campus-agent.ingestion.workflow";
export const DEFAULT_INGESTION_CONTROL_ACTIVITY_TASK_QUEUE =
	"campus-agent.ingestion.activity.control";
export const DEFAULT_INGESTION_RUST_KERNEL_ACTIVITY_TASK_QUEUE =
	"campus-agent.ingestion.activity.rust-kernel";
export const DEFAULT_INGESTION_SOURCE_COLLECTOR_ACTIVITY_TASK_QUEUE =
	"campus-agent.ingestion.activity.source-collector";

export function buildIngestionTemporalConfig(
	env: Record<string, string | undefined>,
): IngestionTemporalConfig {
	return {
		address: requiredEnv(env, "INGESTION_TEMPORAL_ADDRESS"),
		namespace: env.INGESTION_TEMPORAL_NAMESPACE?.trim() || "default",
		workflowTaskQueue: DEFAULT_INGESTION_WORKFLOW_TASK_QUEUE,
		controlActivityTaskQueue: DEFAULT_INGESTION_CONTROL_ACTIVITY_TASK_QUEUE,
		rustKernelActivityTaskQueue: DEFAULT_INGESTION_RUST_KERNEL_ACTIVITY_TASK_QUEUE,
		sourceCollectorActivityTaskQueue: DEFAULT_INGESTION_SOURCE_COLLECTOR_ACTIVITY_TASK_QUEUE,
	};
}

function requiredEnv(env: Record<string, string | undefined>, key: string): string {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`${key} is required`);
	}
	return value;
}
