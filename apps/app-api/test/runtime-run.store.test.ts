// @vitest-environment node

import { describe, expect, it } from "vitest";
import { pgRuntimeRunStoreHarness } from "./runtime-run.test-support";

describe("pg runtime run store", () => {
	it("retains frozen execution input when pending admission is locally cancelled", async () => {
		const { set, store } = pgRuntimeRunStoreHarness("pending_admission");
		const requestedAt = "2026-06-04T01:02:05.000Z";

		await expect(
			store.requestCancellation({
				ownerUserId: "user_01HQ",
				reason: "user_requested",
				requestedAt,
				runId: "run_01HQ",
			}),
		).resolves.toMatchObject({
			kind: "local_finalization",
			run: {
				admissionStatus: "cancelled",
				cancelOutboxStatus: "local_finalization_pending",
			},
		});
		expect(set).toHaveBeenCalledWith({
			admissionInputJson: null,
			admissionInputSha256: null,
			admissionStatus: "cancelled",
			cancelOutboxStatus: "local_finalization_pending",
			cancelLeaseToken: null,
			cancelLeaseUntil: null,
			cancelReason: "user_requested",
			cancelRequestedAt: new Date(requestedAt),
			updatedAt: new Date(requestedAt),
		});
	});

	it("keeps execution input owned when the admission claim wins the cancellation race", async () => {
		const { set, store } = pgRuntimeRunStoreHarness("dispatching");
		const requestedAt = "2026-06-04T01:02:05.000Z";

		await expect(
			store.requestCancellation({
				ownerUserId: "user_01HQ",
				reason: "user_requested",
				requestedAt,
				runId: "run_01HQ",
			}),
		).resolves.toMatchObject({
			kind: "remote_delivery",
			run: {
				admissionStatus: "dispatching",
				cancelOutboxStatus: "pending_delivery",
			},
		});
		expect(set).toHaveBeenCalledWith({
			cancelOutboxStatus: "pending_delivery",
			cancelLeaseToken: null,
			cancelLeaseUntil: null,
			cancelReason: "user_requested",
			cancelRequestedAt: new Date(requestedAt),
			updatedAt: new Date(requestedAt),
		});
	});
});
