import { describe, expect, it } from "vitest";
import { resolveWorkerDeploymentOptions } from "../src/worker-versioning.ts";

describe("source-collector worker versioning", () => {
	it("configures a pinned Worker Deployment version", () => {
		expect(
			resolveWorkerDeploymentOptions({
				TEMPORAL_DEPLOYMENT_NAME: "source-collector-worker",
				TEMPORAL_WORKER_BUILD_ID: "build-001",
			}),
		).toEqual({
			defaultVersioningBehavior: "PINNED",
			useWorkerVersioning: true,
			version: {
				buildId: "build-001",
				deploymentName: "source-collector-worker",
			},
		});
	});

	it("allows unversioned local workers only when both values are absent", () => {
		expect(resolveWorkerDeploymentOptions({})).toBeUndefined();
		expect(() =>
			resolveWorkerDeploymentOptions({ TEMPORAL_DEPLOYMENT_NAME: "source-collector-worker" }),
		).toThrow(/must be configured together/u);
		expect(() => resolveWorkerDeploymentOptions({ TEMPORAL_WORKER_BUILD_ID: "build-001" })).toThrow(
			/must be configured together/u,
		);
	});
});
