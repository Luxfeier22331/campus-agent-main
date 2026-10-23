import { describe, expect, it } from "vitest";

import {
	selectTransportPeriod,
	TransportPublicScheduleResponseSchema,
	TransportSchedulePeriodInputSchema,
	transportDateRange,
	transportPeriodIncludesDate,
	transportServiceKindLabel,
} from "../src/domain/schedule.ts";

const operatingPeriod = {
	boardingPointOverride: null,
	items: [
		{
			boardingPoint: null,
			capacity: null,
			departureTime: "07:30",
			kind: "fixed" as const,
			note: null,
			riderType: "all" as const,
			sortOrder: 0,
		},
		{
			boardingPoint: null,
			capacity: 40,
			firstDepartureTime: "09:00",
			intervalMinutes: 20,
			kind: "interval" as const,
			lastDepartureTime: "10:00",
			note: "客流较大时按现场安排发车",
			riderType: "student" as const,
			sortOrder: 1,
		},
	],
	note: null,
	routeId: "route:fengtai-to-haidian",
	status: "operating" as const,
	validFrom: "2026-08-31",
	validTo: null,
	weekdays: [1, 2, 3, 4, 5],
};

describe("transport schedule model", () => {
	it("accepts a complete operating period with fixed and interval items", () => {
		expect(TransportSchedulePeriodInputSchema.parse(operatingPeriod)).toEqual(operatingPeriod);
	});

	it("selects a period by inclusive date range and ISO weekday", () => {
		expect(transportPeriodIncludesDate(operatingPeriod, "2026-09-07")).toBe(true);
		expect(transportPeriodIncludesDate(operatingPeriod, "2026-09-06")).toBe(false);
		expect(transportPeriodIncludesDate(operatingPeriod, "2026-08-30")).toBe(false);
	});

	it("selects the narrowest newer override without mutating the input", () => {
		const periods = [
			{
				...operatingPeriod,
				scheduleId: "base",
				sourceReleasedAt: "2026-09-09T00:00:00.000Z",
				updatedAt: "2026-09-01T00:00:00.000Z",
			},
			{
				...operatingPeriod,
				scheduleId: "special",
				sourceReleasedAt: null,
				validFrom: "2026-09-10",
				validTo: "2026-09-12",
				updatedAt: "2026-09-01T00:00:00.000Z",
			},
		];
		const selected = selectTransportPeriod(periods, "2026-09-11");
		expect(selected?.scheduleId).toBe("special");
		expect(periods.map((period) => period.scheduleId)).toEqual(["base", "special"]);
	});

	it("limits a date range to 31 days", () => {
		expect(transportDateRange("2026-09-10", "2026-09-10")).toEqual(["2026-09-10"]);
		expect(transportDateRange("2026-09-01", "2026-10-01")).toHaveLength(31);
		expect(() => transportDateRange("2026-09-01", "2026-10-02")).toThrow("1 至 31 天");
	});

	it("rejects invalid operating and suspended period contents", () => {
		expect(() =>
			TransportSchedulePeriodInputSchema.parse({ ...operatingPeriod, items: [] }),
		).toThrow("运行中的班次必须至少包含一条班次明细");
		expect(() =>
			TransportSchedulePeriodInputSchema.parse({
				...operatingPeriod,
				items: [],
				status: "suspended",
			}),
		).not.toThrow();
		expect(() =>
			TransportSchedulePeriodInputSchema.parse({
				...operatingPeriod,
				status: "suspended",
			}),
		).toThrow("停运期间不能包含班次明细");
	});

	it("keeps the public response limited to the structured schedule", () => {
		const response = TransportPublicScheduleResponseSchema.parse({
			date: "2026-09-07",
			routeCatalog: [],
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
							riderType: "all",
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

		expect(response.routes[0]).not.toHaveProperty("evidence");
		expect(response.routes[0]).not.toHaveProperty("operation");
	});

	it("labels the three supported service kinds", () => {
		expect(transportServiceKindLabel("commute")).toBe("两校区通勤");
		expect(transportServiceKindLabel("subway")).toBe("地铁接驳");
		expect(transportServiceKindLabel("special")).toBe("临时班次");
	});
});
