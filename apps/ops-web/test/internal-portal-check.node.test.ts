// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
	buildCheckRunEvent,
	buildCheckRunFailureEvent,
	buildCredentialCheckEvent,
} from "../src/server/internal-portal-check.ts";
import { InternalPortalCredentialStoreUnavailableError } from "../src/server/internal-portal-credential-store.ts";

const CREDENTIAL_ID = "11111111-1111-4111-8111-111111111111";

describe("internal portal scheduled check telemetry", () => {
	it("emits one bounded event for each credential check", () => {
		expect(
			buildCredentialCheckEvent({
				credentialId: CREDENTIAL_ID,
				credentialName: "第一条",
				durationMs: 125,
				failureKind: "credential_expired",
				outcome: "credential_rejected",
				refreshed: false,
			}),
		).toEqual({
			duration_ms: 125,
			event_type: "internal_portal.credential_check",
			failure_kind: "credential_expired",
			"internal_portal.credential_id": CREDENTIAL_ID,
			"internal_portal.credential_name": "第一条",
			"internal_portal.refreshed": false,
			level: "error",
			status: "credential_rejected",
		});
	});

	it("summarizes checked, failed, suspended, and stale credentials", () => {
		const event = buildCheckRunEvent(
			{
				checks: [
					{
						credentialId: CREDENTIAL_ID,
						credentialName: "第一条",
						durationMs: 20,
						failureKind: null,
						outcome: "stale",
						refreshed: false,
					},
					{
						credentialId: "22222222-2222-4222-8222-222222222222",
						credentialName: "第二条",
						durationMs: 30,
						failureKind: "timeout",
						outcome: "check_failed",
						refreshed: false,
					},
				],
				suspended: [
					{
						credentialId: "33333333-3333-4333-8333-333333333333",
						credentialName: "第三条",
					},
				],
			},
			75,
		);

		expect(event).toEqual({
			duration_ms: 75,
			event_type: "internal_portal.check_run",
			"internal_portal.checked_count": 2,
			"internal_portal.failed_count": 1,
			"internal_portal.stale_count": 1,
			"internal_portal.suspended_count": 1,
			level: "error",
			status: "failed",
		});
	});

	it("does not serialize credential material from failures", () => {
		const credentialMaterial =
			"Path=/; JSESSIONID=synthetic; nginx=synthetic; SSO_TGC=TGT-synthetic-secret";
		const event = buildCheckRunFailureEvent(
			new InternalPortalCredentialStoreUnavailableError("store unavailable", {
				cause: new Error(credentialMaterial),
			}),
			250,
		);
		const serialized = JSON.stringify(event);

		expect(event).toEqual({
			duration_ms: 250,
			event_type: "internal_portal.check_run",
			failure_kind: "store_unavailable",
			level: "error",
			status: "failed",
		});
		for (const forbidden of ["SSO_TGC", "TGT-synthetic-secret", "JSESSIONID", "nginx"]) {
			expect(serialized).not.toContain(forbidden);
		}
	});
});
