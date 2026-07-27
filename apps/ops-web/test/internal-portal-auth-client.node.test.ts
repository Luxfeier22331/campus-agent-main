// @vitest-environment node

import type { V1CronJob, V1Secret } from "@kubernetes/client-node";
import { describe, expect, it, vi } from "vitest";
import {
	createInternalPortalAuthClient,
	INTERNAL_PORTAL_AUTH_SECRET_NAME,
	INTERNAL_PORTAL_AUTH_UPDATED_AT_ANNOTATION,
	InternalPortalAuthUnavailableError,
	mapInternalPortalAuthStatus,
} from "../src/server/internal-portal-auth-client";

describe("internal portal authentication Kubernetes client", () => {
	it("maps the fixed Secret and CronJob status without exposing credential data", () => {
		const status = mapInternalPortalAuthStatus(
			createSecret("2026-07-27T10:00:00.000Z"),
			createCronJob({
				lastScheduleTime: new Date("2026-07-27T10:30:00.000Z"),
				lastSuccessfulTime: new Date("2026-07-27T10:30:04.000Z"),
			}),
		);

		expect(status).toEqual({
			credentialUpdatedAt: "2026-07-27T10:00:00.000Z",
			currentCredentialChecked: true,
			lastScheduledAt: "2026-07-27T10:30:00.000Z",
			lastSuccessfulAt: "2026-07-27T10:30:04.000Z",
			latestRun: "succeeded",
		});
		expect(JSON.stringify(status)).not.toContain("TGT-secret");
	});

	it("reports running and failed executions from native CronJob fields", () => {
		expect(
			mapInternalPortalAuthStatus(
				createSecret("2026-07-27T10:00:00.000Z"),
				createCronJob({ active: [{ name: "auth-check-running" }] }),
			).latestRun,
		).toBe("running");
		expect(
			mapInternalPortalAuthStatus(
				createSecret("2026-07-27T10:00:00.000Z"),
				createCronJob({ lastScheduleTime: new Date("2026-07-27T10:30:00.000Z") }),
			).latestRun,
		).toBe("failed");
	});

	it("does not attribute a pre-update job success to the replacement credential", () => {
		const status = mapInternalPortalAuthStatus(
			createSecret("2026-07-27T10:30:02.000Z"),
			createCronJob({
				lastScheduleTime: new Date("2026-07-27T10:30:00.000Z"),
				lastSuccessfulTime: new Date("2026-07-27T10:30:04.000Z"),
			}),
		);

		expect(status.latestRun).toBe("succeeded");
		expect(status.currentCredentialChecked).toBe(false);
	});

	it("reads current status before merge-patching only the fixed credential fields", async () => {
		const patchSecret = vi.fn().mockResolvedValue(undefined);
		const client = createInternalPortalAuthClient({
			now: () => new Date("2026-07-27T11:00:00.000Z"),
			resources: {
				patchSecret,
				readCronJob: vi.fn().mockResolvedValue(
					createCronJob({
						lastScheduleTime: new Date("2026-07-27T10:30:00.000Z"),
						lastSuccessfulTime: new Date("2026-07-27T10:30:04.000Z"),
					}),
				),
				readSecret: vi.fn().mockResolvedValue(createSecret("2026-07-27T10:00:00.000Z")),
			},
		});

		const status = await client.replaceCredential("TGT-replacement");

		expect(patchSecret).toHaveBeenCalledWith({
			apiVersion: "v1",
			kind: "Secret",
			metadata: {
				annotations: {
					[INTERNAL_PORTAL_AUTH_UPDATED_AT_ANNOTATION]: "2026-07-27T11:00:00.000Z",
				},
				name: INTERNAL_PORTAL_AUTH_SECRET_NAME,
			},
			stringData: { sso_tgc: "TGT-replacement" },
		});
		expect(status).toMatchObject({
			credentialUpdatedAt: "2026-07-27T11:00:00.000Z",
			currentCredentialChecked: false,
		});
		expect(JSON.stringify(status)).not.toContain("TGT-replacement");
	});

	it("fails explicitly when the Secret update timestamp is invalid", async () => {
		const client = createInternalPortalAuthClient({
			resources: {
				patchSecret: vi.fn(),
				readCronJob: vi.fn().mockResolvedValue(createCronJob({})),
				readSecret: vi.fn().mockResolvedValue(createSecret("not-a-time")),
			},
		});

		await expect(client.getStatus()).rejects.toBeInstanceOf(InternalPortalAuthUnavailableError);
	});
});

function createSecret(updatedAt: string): V1Secret {
	return {
		apiVersion: "v1",
		data: { sso_tgc: Buffer.from("TGT-secret").toString("base64") },
		kind: "Secret",
		metadata: {
			annotations: { [INTERNAL_PORTAL_AUTH_UPDATED_AT_ANNOTATION]: updatedAt },
			creationTimestamp: new Date("2026-07-01T00:00:00.000Z"),
			name: INTERNAL_PORTAL_AUTH_SECRET_NAME,
		},
	};
}

function createCronJob(status: NonNullable<V1CronJob["status"]>): V1CronJob {
	return {
		apiVersion: "batch/v1",
		kind: "CronJob",
		metadata: { name: "source-collector-auth-check" },
		spec: {
			jobTemplate: { spec: { template: { spec: { containers: [], restartPolicy: "Never" } } } },
			schedule: "*/30 * * * *",
		},
		status,
	};
}
