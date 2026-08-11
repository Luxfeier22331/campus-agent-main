// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
	buildChatAvailabilityService,
	CHAT_AVAILABILITY_WINDOW_MS,
	type ChatAvailabilityStore,
} from "../src/modules/chat-availability";

function createStore(status: string | null): ChatAvailabilityStore {
	return {
		getLatestStatusSince: vi.fn().mockResolvedValue(status),
	};
}

describe("chat availability service", () => {
	it.each([
		["completed", "operational"],
		["needs_clarification", "operational"],
		["no_answer", "operational"],
		["approval_required", "operational"],
		["rejected", "operational"],
		["cancelled", "operational"],
		["error", "outage"],
		["accepted", "unknown"],
		[null, "unknown"],
	] as const)("maps the latest status %s to %s", async (latestStatus, expected) => {
		const store = createStore(latestStatus);
		const now = new Date("2026-08-11T08:30:00.000Z");
		const service = buildChatAvailabilityService({ now: () => now, store });

		await expect(service.getAvailability()).resolves.toEqual({ status: expected });
		expect(store.getLatestStatusSince).toHaveBeenCalledWith(
			new Date(now.valueOf() - CHAT_AVAILABILITY_WINDOW_MS),
		);
	});

	it("fails when persisted data contains an unsupported status", async () => {
		const service = buildChatAvailabilityService({ store: createStore("unexpected") });
		await expect(service.getAvailability()).rejects.toThrow("Unexpected chat turn status");
	});
});
