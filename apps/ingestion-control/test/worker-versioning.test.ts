import { describe, expect, it } from "vitest";
import { resolveWorkerDeploymentOptions } from "../src/worker-versioning";

describe("Temporal worker deployment options", () => {
	it("allows unversioned local workers when controller variables are absent", () => {
		expect(resolveWorkerDeploymentOptions({})).toBeUndefined();
	});

	it("enables pinned worker deployment versioning", () => {
		expect(
			resolveWorkerDeploymentOptions({
				TEMPORAL_DEPLOYMENT_NAME: "ingestion-control",
				TEMPORAL_WORKER_BUILD_ID: "build-001",
			}),
		).toEqual({
			defaultVersioningBehavior: "PINNED",
			useWorkerVersioning: true,
			version: { buildId: "build-001", deploymentName: "ingestion-control" },
		});
	});

	it("rejects a partial controller environment", () => {
		expect(() =>
			resolveWorkerDeploymentOptions({ TEMPORAL_DEPLOYMENT_NAME: "ingestion-control" }),
		).toThrow("must be configured together");
	});
});
