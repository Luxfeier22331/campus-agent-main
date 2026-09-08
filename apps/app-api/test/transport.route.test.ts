// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app";
import { AppApiRouteError } from "../src/http";
import type { TransportScheduleService } from "../src/modules/transport";

const env = {
	DEPLOYMENT_ENVIRONMENT: "test" as const,
	AUTH_SHELL_ORIGIN: "https://campus.muc.wiki",
	BETTER_AUTH_SECRET: "dev-secret-dev-secret-dev-secret",
	APP_API_DB: { connectionString: "postgres://postgres:secret@example.com:5432/campus_agent" },
};

function service(): TransportScheduleService {
	return {
		getSchedule: vi.fn(async (date) => ({ date, routes: [] })),
	};
}

describe("transport schedule route", () => {
	it("serves a public local-date schedule with a shared cache boundary", async () => {
		const transportScheduleService = service();
		const app = createApp(env, { transportScheduleService });

		const response = await app.fetch(
			new Request("https://app-api.internal/api/transport/schedule?date=2026-09-06"),
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("public, max-age=30, s-maxage=60");
		await expect(response.json()).resolves.toEqual({ date: "2026-09-06", routes: [] });
		expect(transportScheduleService.getSchedule).toHaveBeenCalledWith("2026-09-06");
	});

	it("rejects malformed dates before calling the schedule service", async () => {
		const transportScheduleService = service();
		const app = createApp(env, { transportScheduleService });

		for (const query of ["", "date=2026/09/06", "date=not-a-date"]) {
			const response = await app.fetch(
				new Request(`https://app-api.internal/api/transport/schedule${query ? `?${query}` : ""}`),
			);

			expect(response.status, query).toBe(400);
			expect(response.headers.get("cache-control"), query).toBe("no-store");
			await expect(response.json()).resolves.toMatchObject({
				error: { code: "transport_date_invalid" },
			});
		}
		expect(transportScheduleService.getSchedule).not.toHaveBeenCalled();
	});

	it("returns projection errors without converting them to an internal failure", async () => {
		const transportScheduleService = service();
		vi.mocked(transportScheduleService.getSchedule).mockRejectedValueOnce(
			new AppApiRouteError({
				code: "transport_projection_invalid",
				details: { routeId: "route:test" },
				message: "班车事实无效。",
				retryable: false,
				status: 400,
			}),
		);
		const app = createApp(env, { transportScheduleService });

		const response = await app.fetch(
			new Request("https://app-api.internal/api/transport/schedule?date=2026-09-06"),
		);

		expect(response.status).toBe(400);
		expect(response.headers.get("cache-control")).toBe("no-store");
		await expect(response.json()).resolves.toMatchObject({
			error: {
				code: "transport_projection_invalid",
				details: { routeId: "route:test" },
			},
		});
	});
});
