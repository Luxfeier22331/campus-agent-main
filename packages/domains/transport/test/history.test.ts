import { describe, expect, it } from "vitest";
import { selectTransportPeriod, TransportSchedulePeriodInputSchema } from "../src/domain/schedule";
import {
	CONTROLLED_CHANGE_SCENARIOS as changes,
	type HistoryPeriod,
	MAY_DAY_PERIODS,
	PERMANENT_INCREASE_PERIODS,
	SUBWAY_SUSPENSIONS,
	SUMMER_PERIODS,
	selectableHistory,
} from "./fixtures/history";

function selected(periods: HistoryPeriod[], date: string, direction = "fengtai-to-haidian") {
	return selectTransportPeriod(
		selectableHistory(periods).filter((p) => p.routeId === `route:${direction}`),
		date,
	);
}
function times(periods: HistoryPeriod[], date: string, direction?: string) {
	return (
		selected(periods, date, direction)?.items.map((item) =>
			item.kind === "fixed" ? `${item.departureTime}/${item.riderType}` : "interval",
		) ?? []
	);
}
describe("human-reviewed historical notice samples", () => {
	it("all real tables and controlled changes fit the complete-period model", () => {
		for (const { input } of [
			...MAY_DAY_PERIODS,
			...SUMMER_PERIODS,
			...PERMANENT_INCREASE_PERIODS,
			...SUBWAY_SUSPENSIONS,
			...Object.values(changes).flat(),
		]) {
			expect(TransportSchedulePeriodInputSchema.safeParse(input).success).toBe(true);
		}
	});
	it("355867: April27 has 24 commute trips; April28–May5 has six directions and 25 trips", () => {
		expect(
			MAY_DAY_PERIODS.filter((p) => p.input.validFrom === "2026-04-27").reduce(
				(n, p) => n + p.input.items.length,
				0,
			),
		).toBe(24);
		for (const date of ["2026-04-28", "2026-05-01", "2026-05-05"]) {
			const directions = new Set(MAY_DAY_PERIODS.map((p) => p.input.routeId));
			const tables = [...directions].map((id) =>
				selectTransportPeriod(
					selectableHistory(MAY_DAY_PERIODS).filter((p) => p.routeId === id),
					date,
				),
			);
			expect(tables.filter(Boolean)).toHaveLength(6);
			expect(tables.reduce((n, p) => n + (p?.items.length ?? 0), 0)).toBe(25);
		}
		expect(times(MAY_DAY_PERIODS, "2026-04-26")).toEqual([]);
		expect(times(MAY_DAY_PERIODS, "2026-04-27")).toContain("16:20/student");
		expect(times(MAY_DAY_PERIODS, "2026-04-28")).toEqual([
			"08:00/student",
			"12:30/teacher",
			"18:10/teacher",
		]);
		expect(times(MAY_DAY_PERIODS, "2026-05-06")).toEqual([]);
	});
	it("354343: shifts only teachers over two separated five-day ranges", () => {
		for (const date of ["2026-01-05", "2026-01-09", "2026-01-12", "2026-01-16"]) {
			expect(times(changes.timeShift, date)).toEqual(["16:20/teacher", "16:20/student"]);
		}
		for (const date of ["2026-01-04", "2026-01-10", "2026-01-11", "2026-01-17"]) {
			expect(times(changes.timeShift, date)).toEqual(["16:00/teacher", "16:20/student"]);
		}
	});
	it("355512: single-day student addition does not overwrite surrounding dates", () => {
		expect(times(changes.addition, "2026-04-10")).toEqual(["08:00/student"]);
		expect(times(changes.addition, "2026-04-11")).toEqual(["06:40/student", "08:00/student"]);
		expect(times(changes.addition, "2026-04-12")).toEqual(["08:00/student"]);
	});
	it("351862: weekend boarding override ends; 353903: permanent boarding/drop-off persists", () => {
		for (const date of ["2025-09-06", "2025-09-07"]) {
			expect(
				selected(changes.temporaryBoarding, date, "fengtai-to-wukesong")?.boardingPointOverride,
			).toBe("智慧中心南侧");
		}
		for (const date of ["2025-09-05", "2025-09-08", "2025-09-13"]) {
			expect(
				selected(changes.temporaryBoarding, date, "fengtai-to-wukesong")?.boardingPointOverride,
			).toBe("受控起始乘车点");
		}
		expect(
			selected(changes.permanentLocation, "2025-12-14", "haidian-to-fengtai")?.dropOffPointOverride,
		).toBeNull();
		for (const date of ["2025-12-15", "2025-12-16", "2026-01-15"]) {
			expect(
				selected(changes.permanentLocation, date, "haidian-to-fengtai")?.dropOffPointOverride,
			).toBe("聚雅餐厅东侧停车场路口");
			expect(selected(changes.permanentLocation, date)?.boardingPointOverride).toBe(
				"聚雅餐厅东侧停车场路口",
			);
		}
	});
	it("357803: summer weekdays and weekends differ in both directions, ending August30", () => {
		expect(times(SUMMER_PERIODS, "2026-07-12")).toEqual([]);
		expect(times(SUMMER_PERIODS, "2026-07-13")).toEqual(["06:40/all", "07:30/all", "17:00/all"]);
		expect(times(SUMMER_PERIODS, "2026-07-13", "haidian-to-fengtai")).toEqual([
			"08:00/all",
			"19:00/all",
			"20:50/all",
		]);
		for (const date of ["2026-07-18", "2026-08-30"]) {
			expect(times(SUMMER_PERIODS, date)).toEqual(["07:30/all", "17:00/all"]);
			expect(times(SUMMER_PERIODS, date, "haidian-to-fengtai")).toEqual(["08:00/all", "19:00/all"]);
		}
		expect(times(SUMMER_PERIODS, "2026-08-31")).toEqual([]);
	});
	it("356341 + 357813 + 358327: permanent 17:00 increase, directional suspension then resumption", () => {
		const periods = [...PERMANENT_INCREASE_PERIODS, ...SUBWAY_SUSPENSIONS];
		expect(times(periods, "2026-05-15", "fengtai-to-wukesong")).toEqual([]);
		for (const date of ["2026-05-16", "2026-05-17", "2026-07-11", "2026-07-12", "2026-09-05"]) {
			expect(times(periods, date, "fengtai-to-wukesong")).toHaveLength(9);
			expect(times(periods, date, "fengtai-to-wukesong")).toContain("17:00/all");
		}
		for (const date of ["2026-07-11", "2026-07-12", "2026-07-13", "2026-09-04"]) {
			expect(selected(periods, date, "wukesong-to-fengtai")?.status).toBe("suspended");
		}
		expect(selected(periods, "2026-07-13", "fengtai-to-wukesong")?.status).toBe("suspended");
		expect(times(periods, "2026-09-05", "wukesong-to-fengtai")).toHaveLength(7);
	});
});
