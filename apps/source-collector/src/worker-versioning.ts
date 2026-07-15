import type { WorkerDeploymentOptions } from "@temporalio/worker";

export function resolveWorkerDeploymentOptions(
	env: Record<string, string | undefined>,
): WorkerDeploymentOptions | undefined {
	const deploymentName = env.TEMPORAL_DEPLOYMENT_NAME?.trim();
	const buildId = env.TEMPORAL_WORKER_BUILD_ID?.trim();
	if (!(deploymentName || buildId)) {
		return;
	}
	if (!(deploymentName && buildId)) {
		throw new Error(
			"TEMPORAL_DEPLOYMENT_NAME and TEMPORAL_WORKER_BUILD_ID must be configured together",
		);
	}
	return {
		defaultVersioningBehavior: "PINNED",
		useWorkerVersioning: true,
		version: { buildId, deploymentName },
	};
}
