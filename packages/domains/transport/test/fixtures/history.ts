import type { TransportRiderType, TransportSchedulePeriodInput } from "../../src/domain/schedule";

// Test/local acceptance only. Complete tables are transcribed from saved notice OCR.
// Partial-change scenarios below explicitly use controlled starting tables, not a
// backdated autumn baseline. Notice IDs identify the human-reviewed source.
export interface HistoryPeriod {
	scheduleId: string;
	noticeIds: string[];
	input: TransportSchedulePeriodInput;
}
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7];
export const historyItems = (
	entries: readonly (string | readonly [string, TransportRiderType])[],
) =>
	entries.map((entry, sortOrder) => ({
		kind: "fixed" as const,
		departureTime: typeof entry === "string" ? entry : entry[0],
		riderType: typeof entry === "string" ? ("all" as const) : entry[1],
		boardingPoint: null,
		capacity: null,
		note: null,
		sortOrder,
	}));

function period(
	id: string,
	direction: string,
	from: string,
	to: string | null,
	entries: Parameters<typeof historyItems>[0],
	overrides: Partial<TransportSchedulePeriodInput> = {},
): HistoryPeriod {
	return {
		scheduleId: `history:${id}:${direction}:${from}:${overrides.weekdays?.join("") ?? "daily"}`,
		noticeIds: [id],
		input: {
			routeId: `route:${direction}`,
			validFrom: from,
			validTo: to,
			weekdays: EVERY_DAY,
			status: entries.length > 0 ? "operating" : "suspended",
			items: historyItems(entries),
			boardingPointOverride: null,
			dropOffPointOverride: null,
			note: null,
			...overrides,
		},
	};
}

const wukesongOutbound = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "15:00", "16:00"];
const wukesongInbound = ["18:30", "19:30", "20:00", "20:30", "21:00", "21:30", "22:00"];
export const MAY_DAY_PERIODS: HistoryPeriod[] = [
	period(
		"355867",
		"haidian-to-fengtai",
		"2026-04-27",
		"2026-04-27",
		[
			["06:40", "teacher"],
			["08:10", "student"],
			["08:30", "teacher"],
			["11:00", "teacher"],
			["12:30", "teacher"],
			["14:30", "teacher"],
			["16:30", "teacher"],
			["17:45", "student"],
			["19:30", "student"],
			["20:55", "student"],
			["21:45", "student"],
		],
		{ boardingPointOverride: "东门内" },
	),
	period(
		"355867",
		"fengtai-to-haidian",
		"2026-04-27",
		"2026-04-27",
		[
			["06:40", "teacher"],
			["07:30", "student"],
			["08:10", "student"],
			["10:50", "teacher"],
			["12:30", "teacher"],
			["13:00", "teacher"],
			["13:30", "teacher"],
			["16:00", "teacher"],
			["16:20", "student"],
			["17:45", "teacher"],
			["18:45", "teacher"],
			["20:55", "teacher"],
			["21:45", "teacher"],
		],
		{ boardingPointOverride: "聚雅餐厅东侧停车场路口" },
	),
	period(
		"355867",
		"haidian-to-fengtai",
		"2026-04-28",
		"2026-05-05",
		[
			["08:00", "teacher"],
			["12:30", "student"],
			["16:30", "teacher"],
			["18:10", "teacher"],
			["20:30", "student"],
		],
		{ boardingPointOverride: "东门内" },
	),
	period(
		"355867",
		"fengtai-to-haidian",
		"2026-04-28",
		"2026-05-05",
		[
			["08:00", "student"],
			["12:30", "teacher"],
			["18:10", "teacher"],
		],
		{ boardingPointOverride: "聚雅餐厅东侧停车场路口" },
	),
	period("355867", "fengtai-to-wukesong", "2026-04-28", "2026-05-05", wukesongOutbound, {
		boardingPointOverride: "聚雅餐厅东侧停车场路口",
	}),
	period("355867", "wukesong-to-fengtai", "2026-04-28", "2026-05-05", wukesongInbound, {
		boardingPointOverride: "五棵松地铁站A口（西北口）北侧200米国家开放大学东门口",
	}),
	period("355867", "fengtai-to-libafang", "2026-04-28", "2026-05-05", ["08:00"], {
		boardingPointOverride: "学生活动中心西侧停车场路口",
	}),
	period("355867", "libafang-to-fengtai", "2026-04-28", "2026-05-05", ["20:00"], {
		boardingPointOverride: "篱笆房地铁站B2口",
	}),
];
export const SUMMER_PERIODS = [
	period("357803", "haidian-to-fengtai", "2026-07-13", "2026-08-30", ["08:00", "19:00", "20:50"], {
		weekdays: [1, 2, 3, 4, 5],
	}),
	period("357803", "fengtai-to-haidian", "2026-07-13", "2026-08-30", ["06:40", "07:30", "17:00"], {
		weekdays: [1, 2, 3, 4, 5],
	}),
	period("357803", "haidian-to-fengtai", "2026-07-13", "2026-08-30", ["08:00", "19:00"], {
		weekdays: [6, 7],
	}),
	period("357803", "fengtai-to-haidian", "2026-07-13", "2026-08-30", ["07:30", "17:00"], {
		weekdays: [6, 7],
	}),
];
export const PERMANENT_INCREASE_PERIODS = [
	period("356341", "fengtai-to-wukesong", "2026-05-16", null, [...wukesongOutbound, "17:00"], {
		weekdays: [6, 7],
	}),
	period("356341", "wukesong-to-fengtai", "2026-05-16", null, wukesongInbound, {
		weekdays: [6, 7],
	}),
];
export const SUBWAY_SUSPENSIONS = [
	...["wukesong-to-fengtai", "fengtai-to-libafang", "libafang-to-fengtai"].map((direction) =>
		period("357813", direction, "2026-07-11", "2026-07-12", [], { note: "暑期地铁接驳暂停运行。" }),
	),
	...[
		"fengtai-to-wukesong",
		"wukesong-to-fengtai",
		"fengtai-to-libafang",
		"libafang-to-fengtai",
	].map((direction) => ({
		...period("357813", direction, "2026-07-13", "2026-09-04", [], {
			note: "暑期地铁接驳停运，9月5日起恢复。",
		}),
		noticeIds: ["357813", "358327"],
	})),
];

export const CONTROLLED_CHANGE_SCENARIOS = {
	// Only the changed trip is factual; the starting table is deliberately minimal.
	timeShift: [
		{
			...period("354343", "fengtai-to-haidian", "2026-01-01", "2026-01-31", [
				["16:00", "teacher"],
				["16:20", "student"],
			]),
			noticeIds: [],
		},
		...["2026-01-05", "2026-01-12"].map((from, index) =>
			period("354343", "fengtai-to-haidian", from, index === 0 ? "2026-01-09" : "2026-01-16", [
				["16:20", "teacher"],
				["16:20", "student"],
			]),
		),
	],
	addition: [
		{
			...period("355512", "fengtai-to-haidian", "2026-04-01", "2026-04-30", [["08:00", "student"]]),
			noticeIds: [],
		},
		period("355512", "fengtai-to-haidian", "2026-04-11", "2026-04-11", [
			["06:40", "student"],
			["08:00", "student"],
		]),
	],
	temporaryBoarding: [
		{
			...period("351862", "fengtai-to-wukesong", "2025-09-01", "2025-09-14", ["09:00"], {
				boardingPointOverride: "受控起始乘车点",
			}),
			noticeIds: [],
		},
		period("351862", "fengtai-to-wukesong", "2025-09-06", "2025-09-07", ["09:00"], {
			boardingPointOverride: "智慧中心南侧",
		}),
	],
	permanentLocation: [
		{ ...period("353903", "haidian-to-fengtai", "2025-12-01", null, ["08:00"]), noticeIds: [] },
		period("353903", "haidian-to-fengtai", "2025-12-15", null, ["08:00"], {
			dropOffPointOverride: "聚雅餐厅东侧停车场路口",
		}),
		{ ...period("353903", "fengtai-to-haidian", "2025-12-01", null, ["08:00"]), noticeIds: [] },
		period("353903", "fengtai-to-haidian", "2025-12-15", null, ["08:00"], {
			boardingPointOverride: "聚雅餐厅东侧停车场路口",
		}),
	],
};

export function selectableHistory(periods: readonly HistoryPeriod[]) {
	return periods.map(({ scheduleId, input }) => ({
		...input,
		scheduleId,
		updatedAt: "2026-09-01T00:00:00Z",
	}));
}
