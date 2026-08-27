// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import type { Env } from "../src/config";

const env = {
	DEPLOYMENT_ENVIRONMENT: "test",
} as Env;

describe("GET /api/chat/availability", () => {
	it("returns the anonymous no-store availability response", async () => {
		const getPrincipal = vi.fn();
		const getAvailability = vi.fn().mockResolvedValue({ status: "operational" });
		const response = await createApp(env, {
			chatAvailabilityService: { getAvailability },
			getPrincipal,
		}).request("/api/chat/availability");

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		await expect(response.json()).resolves.toEqual({ status: "operational" });
		expect(getAvailability).toHaveBeenCalledTimes(1);
		expect(getPrincipal).not.toHaveBeenCalled();
	});

	it("returns the generic error response when the database read fails", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const response = await createApp(env, {
			chatAvailabilityService: {
				getAvailability: vi.fn().mockRejectedValue(new Error("database unavailable")),
			},
		}).request("/api/chat/availability");

		expect(response.status).toBe(500);
		expect(response.headers.get("cache-control")).toBe("no-store");
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "internal_error",
				details: null,
				message: "Unexpected app-api failure.",
				requestId: null,
				retryable: true,
			},
		});
		consoleError.mockRestore();
	});
});
