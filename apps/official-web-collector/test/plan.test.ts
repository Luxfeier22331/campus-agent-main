import { describe, expect, it, vi } from "vitest";

import { buildCollectorPlan, main } from "../src/index";

describe("official-web-collector plan shell", () => {
	it("builds a resolved crawl plan for muc_public", () => {
		const plan = buildCollectorPlan("muc_public", {
			crawlRunId: "muc_public-TEST",
			now: new Date("2026-03-28T16:00:00.000Z"),
		});

		expect(plan.siteId).toBe("muc_public");
		expect(plan.crawlRunId).toBe("muc_public-TEST");
		expect(plan.runIntent).toBe("baseline");
		expect(plan.enabledHosts).toHaveLength(34);
		expect(plan.seeds).toHaveLength(34);
		expect(plan.entryHost).toBe("www.muc.edu.cn");
	});

	it("prints plan json from the CLI entrypoint", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);

		try {
			main(["--site-id", "muc_public", "--crawl-run-id", "manual-001", "--run-intent", "hot"]);
			expect(spy).toHaveBeenCalledTimes(1);
			const payload = JSON.parse(spy.mock.calls[0][0] as string) as {
				crawlRunId: string;
				siteId: string;
				runIntent: string;
			};
			expect(payload.siteId).toBe("muc_public");
			expect(payload.crawlRunId).toBe("manual-001");
			expect(payload.runIntent).toBe("hot");
		} finally {
			spy.mockRestore();
		}
	});

	it("fails closed when site id is missing", () => {
		expect(() => main([])).toThrowError(/--site-id is required/);
	});
});
