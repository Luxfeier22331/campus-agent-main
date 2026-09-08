import { describe, expect, it } from "vitest";

import { waitForTransportSchema } from "../ops/db/bootstrap-transport";

describe("transport schema readiness", () => {
	it("waits for a transient connection or missing-schema failure", async () => {
		let attempts = 0;
		let clock = 0;
		await waitForTransportSchema(
			{
				query: async () => {
					attempts += 1;
					if (attempts < 3) {
						const error = new Error("connect ECONNREFUSED") as Error & { code: string };
						error.code = attempts === 1 ? "ECONNREFUSED" : "42P01";
						throw error;
					}
					return {
						rowCount: 1,
						rows: [
							{
								routes: "transport.routes",
								periods: "transport.schedule_periods",
								items: "transport.schedule_items",
							},
						],
					};
				},
			},
			{
				now: () => clock,
				sleep: async (milliseconds) => {
					clock += milliseconds;
				},
				intervalMs: 10,
				timeoutMs: 100,
			},
		);
		expect(attempts).toBe(3);
	});

	it("waits when the schema query returns missing relations", async () => {
		let attempts = 0;
		let clock = 0;
		await waitForTransportSchema(
			{
				query: async () => {
					attempts += 1;
					return {
						rowCount: 1,
						rows:
							attempts === 1
								? [{ routes: null, periods: null, items: null }]
								: [
										{
											routes: "transport.routes",
											periods: "transport.schedule_periods",
											items: "transport.schedule_items",
										},
									],
					};
				},
			},
			{
				now: () => clock,
				sleep: async (milliseconds) => {
					clock += milliseconds;
				},
				intervalMs: 10,
				timeoutMs: 100,
			},
		);
		expect(attempts).toBe(2);
	});

	it("does not retry authentication or permission errors", async () => {
		let attempts = 0;
		await expect(
			waitForTransportSchema(
				{
					query: async () => {
						attempts += 1;
						const error = new Error("password authentication failed") as Error & { code: string };
						error.code = "28P01";
						throw error;
					},
				},
				{ sleep: async () => undefined },
			),
		).rejects.toThrow("password authentication failed");
		expect(attempts).toBe(1);
	});
});
