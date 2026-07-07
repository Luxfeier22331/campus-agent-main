export interface IngestionTemporalConfig {
	address: string;
	namespace: string;
	workflowTaskQueue: string;
	controlActivityTaskQueue: string;
}

export const DEFAULT_INGESTION_WORKFLOW_TASK_QUEUE = "campus-agent.ingestion.workflow";
export const DEFAULT_INGESTION_CONTROL_ACTIVITY_TASK_QUEUE =
	"campus-agent.ingestion.activity.control";

export function buildIngestionTemporalConfig(
	env: Record<string, string | undefined>,
): IngestionTemporalConfig {
	return {
		address: requiredEnv(env, "INGESTION_TEMPORAL_ADDRESS"),
		namespace: env.INGESTION_TEMPORAL_NAMESPACE?.trim() || "default",
		workflowTaskQueue:
			env.INGESTION_TEMPORAL_WORKFLOW_TASK_QUEUE?.trim() || DEFAULT_INGESTION_WORKFLOW_TASK_QUEUE,
		controlActivityTaskQueue:
			env.INGESTION_TEMPORAL_CONTROL_ACTIVITY_TASK_QUEUE?.trim() ||
			DEFAULT_INGESTION_CONTROL_ACTIVITY_TASK_QUEUE,
	};
}

function requiredEnv(env: Record<string, string | undefined>, key: string): string {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`${key} is required`);
	}
	return value;
}
