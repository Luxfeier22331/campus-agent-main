import {
	TransportPublicScheduleResponseSchema,
	transportPeriodIncludesDate,
} from "@campus-agent/transport/domain";
import { describe, expect, it } from "vitest";

describe("transport public schedule model", () => {
	it("accepts the structured response used by Campus Web", () => {
		const response = TransportPublicScheduleResponseSchema.parse({
			date: "2026-09-07",
			routeCatalog: [
				{
					boardingGuide: null,
					defaultBoardingPoint: "聚雅餐厅东侧停车场路口",
					destination: "海淀校区",
					dropOffPoint: null,
					nextServiceDate: "2026-09-07",
					origin: "丰台校区",
					routeId: "route:fengtai-to-haidian",
					serviceKind: "commute",
				},
			],
			routes: [
				{
					boardingPoint: "聚雅餐厅东侧停车场路口",
					departures: [
						{
							boardingPoint: null,
							capacity: null,
							departureTime: "07:30",
							kind: "fixed",
							note: null,
							riderType: "student",
						},
					],
					destination: "海淀校区",
					note: null,
					origin: "丰台校区",
					routeId: "route:fengtai-to-haidian",
					serviceKind: "commute",
					status: "operating",
				},
			],
		});

		expect(response.routes[0]?.departures[0]).toMatchObject({
			departureTime: "07:30",
			riderType: "student",
		});
	});

	it("matches inclusive date ranges and weekdays", () => {
		const period = {
			validFrom: "2026-08-31",
			validTo: null,
			weekdays: [1, 2, 3, 4, 5],
		};
		expect(transportPeriodIncludesDate(period, "2026-09-07")).toBe(true);
		expect(transportPeriodIncludesDate(period, "2026-09-06")).toBe(false);
	});
});
