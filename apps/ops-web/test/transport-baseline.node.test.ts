import {
	TransportRouteInputSchema,
	TransportSchedulePeriodInputSchema,
	transportPeriodIncludesDate,
} from "@campus-agent/transport/domain";
import { describe, expect, it } from "vitest";
import {
	TRANSPORT_BASELINE_PERIODS,
	TRANSPORT_BASELINE_ROUTES,
} from "../ops/db/transport-baseline.ts";

describe("transport initialization data", () => {
	it("keeps the six directions and 32 commute / 18 subway departures", () => {
		expect(TRANSPORT_BASELINE_ROUTES).toHaveLength(6);
		for (const route of TRANSPORT_BASELINE_ROUTES) {
			expect(TransportRouteInputSchema.safeParse(route).success).toBe(true);
		}
		for (const period of TRANSPORT_BASELINE_PERIODS) {
			expect(TransportSchedulePeriodInputSchema.safeParse(period.input).success).toBe(true);
		}
		for (const [kind, expected] of [
			["commute", 32],
			["subway", 18],
		] as const) {
			const routes = new Set(
				TRANSPORT_BASELINE_ROUTES.filter((r) => r.serviceKind === kind).map((r) => r.routeId),
			);
			expect(
				TRANSPORT_BASELINE_PERIODS.filter((p) => routes.has(p.input.routeId)).flatMap(
					(p) => p.input.items,
				),
			).toHaveLength(expected);
		}
	});
	it("uses the rider-specific Haidian boarding point on weekdays and weekends", () => {
		const periods = TRANSPORT_BASELINE_PERIODS.filter(
			(p) => p.input.routeId === "route:haidian-to-fengtai",
		);
		expect(periods).toHaveLength(2);
		for (const { input } of periods) {
			for (const item of input.items) {
				expect(item.boardingPoint).toBe(
					item.riderType === "teacher" ? "校东门内北侧" : "校东门内南侧",
				);
			}
		}
	});
	it("keeps subway boarding points separate from the Fengtai drop-off", () => {
		const route = TRANSPORT_BASELINE_ROUTES.find((r) => r.routeId === "route:wukesong-to-fengtai");
		expect(route?.defaultBoardingPoint).toContain("国家开放大学东门口");
		const period = TRANSPORT_BASELINE_PERIODS.find((p) => p.input.routeId === route?.routeId);
		expect(route?.dropOffPoint).toBe("智慧中心南侧");
		expect(route?.boardingGuide).toContain("周五09:00");
		expect(route?.boardingGuide).toContain("企业微信：工作台 → 接驳车预约");
		expect(period?.input.note).not.toContain("下车");
		expect(period?.input.note).not.toContain("预约");
	});
	it("serves 24 weekday departures and 26 weekend departures", () => {
		for (const [date, count] of [
			["2026-09-08", 24],
			["2026-09-12", 26],
		] as const) {
			const periods = TRANSPORT_BASELINE_PERIODS.filter((p) =>
				transportPeriodIncludesDate(p.input, date),
			);
			expect(periods.flatMap((p) => p.input.items)).toHaveLength(count);
		}
	});
});
