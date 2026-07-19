import { ApplicationFailure } from "@temporalio/workflow";
import { describe, expect, it } from "vitest";

import { runInternalPortalAuthMaintenance } from "../src/workflows/ingestion-task-workflow";

describe("internal portal auth maintenance workflow", () => {
	it("records a complete successful CAS refresh", async () => {
		const activateNoticePublication = async () => "resumed" as const;
		const result = await runInternalPortalAuthMaintenance({
			activateNoticePublication,
			now: timestamps("2026-07-16T00:00:00.000Z", "2026-07-16T00:00:03.000Z"),
			refresh: async () => ({
				noticeProbeSucceeded: true,
				portalSessionEstablished: true,
				refreshedAt: "2026-07-16T00:00:02.000Z",
				serviceTicketIssued: true,
			}),
		});

		expect(result).toMatchObject({
			errorCode: null,
			lastSuccessAt: "2026-07-16T00:00:02.000Z",
			noticeProbeSucceeded: true,
			outcome: "success",
			portalSessionEstablished: true,
			serviceTicketIssued: true,
		});
	});

	it("keeps the schedule active for transient failures and carries the last success", async () => {
		const result = await runInternalPortalAuthMaintenance({
			activateNoticePublication: async () => "already_active",
			lastResult: previousSuccess(),
			now: timestamps("2026-07-16T00:30:00.000Z", "2026-07-16T00:30:04.000Z"),
			refresh: async () => {
				throw new Error("provider timeout");
			},
		});

		expect(result).toMatchObject({
			errorCode: "internal_portal_auth_refresh_transient_failure",
			lastSuccessAt: "2026-07-16T00:00:02.000Z",
			outcome: "transient_failure",
			serviceTicketIssued: false,
		});
	});

	it.each([
		"internal_portal_credential_expired",
		"internal_portal_credential_unavailable",
	] as const)("fails non-retryably for %s so Temporal pauses the schedule", async (errorCode) => {
		await expect(
			runInternalPortalAuthMaintenance({
				activateNoticePublication: async () => "already_active",
				lastResult: previousSuccess(),
				now: timestamps("2026-07-16T01:00:00.000Z", "2026-07-16T01:00:01.000Z"),
				refresh: async () => {
					throw ApplicationFailure.nonRetryable("credential rejected", errorCode);
				},
			}),
		).rejects.toMatchObject({
			details: [
				expect.objectContaining({
					errorCode,
					lastSuccessAt: "2026-07-16T00:00:02.000Z",
				}),
			],
			nonRetryable: true,
			type: errorCode,
		});
	});

	it("reports a transient failure when valid credentials cannot restore the notice schedule", async () => {
		const result = await runInternalPortalAuthMaintenance({
			activateNoticePublication: async () => {
				throw new Error("notice schedule unavailable");
			},
			now: timestamps("2026-07-16T01:30:00.000Z", "2026-07-16T01:30:03.000Z"),
			refresh: async () => ({
				noticeProbeSucceeded: true,
				portalSessionEstablished: true,
				refreshedAt: "2026-07-16T01:30:02.000Z",
				serviceTicketIssued: true,
			}),
		});

		expect(result).toMatchObject({
			errorCode: "internal_portal_notice_schedule_activation_failed",
			lastSuccessAt: "2026-07-16T01:30:02.000Z",
			noticeProbeSucceeded: true,
			outcome: "transient_failure",
			serviceTicketIssued: true,
		});
	});
});

function timestamps(...values: string[]) {
	let index = 0;
	return () => values[Math.min(index++, values.length - 1)] ?? values[0] ?? "";
}

function previousSuccess() {
	return {
		completedAt: "2026-07-16T00:00:03.000Z",
		errorCode: null,
		lastSuccessAt: "2026-07-16T00:00:02.000Z",
		noticeProbeSucceeded: true,
		outcome: "success",
		portalSessionEstablished: true,
		schemaVersion: "internal_portal_auth_maintenance.v1",
		serviceTicketIssued: true,
		startedAt: "2026-07-16T00:00:00.000Z",
	};
}
