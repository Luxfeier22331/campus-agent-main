import type {
	TransportRiderType,
	TransportRouteInput,
	TransportScheduleItem,
	TransportSchedulePeriodInput,
} from "@campus-agent/transport/domain";

export interface TransportBaselinePeriod {
	input: TransportSchedulePeriodInput;
	scheduleId: string;
}

const COMMUTE_GUIDE = [
	"学生乘车须提前申请，经辅导员审批通过后乘车。教师班次优先教师，有空位时可在学生乘车点乘坐。",
	"电脑端：服务门户搜索“通勤”，选择“学生乘坐通勤班车申请”，填写乘车日期和事由后提交。",
	"手机端：企业微信 → 工作台 → 丰台校区 → 学生班车申请。",
].join("\n");
const SUBWAY_GUIDE = [
	"本校师生预约后乘车，现场扫码签到。周五09:00开放周末预约。取消行程请及时取消预约。",
	"企业微信：工作台 → 接驳车预约。",
	"民大通：服务 → 预约服务 → 接驳车预约。",
	"电脑端：服务门户 → 预约 → 接驳车预约。",
].join("\n");

export const TRANSPORT_BASELINE_ROUTES: readonly TransportRouteInput[] = [
	{
		boardingGuide: COMMUTE_GUIDE,
		dropOffPoint: "聚雅餐厅东侧停车场路口",
		defaultBoardingPoint: null,
		destination: "丰台校区",
		displayOrder: 0,
		origin: "海淀校区",
		routeId: "route:haidian-to-fengtai",
		serviceKind: "commute",
	},
	{
		boardingGuide: [
			COMMUTE_GUIDE,
			"海淀校区停车点：教师点在校东门内北侧，学生点在校东门内南侧。",
			"途中可在地铁10号线莲花桥站、地铁6号线花园桥站附近下车。",
		].join("\n"),
		dropOffPoint: "校东门内",
		defaultBoardingPoint: "聚雅餐厅东侧停车场路口",
		destination: "海淀校区",
		displayOrder: 1,
		origin: "丰台校区",
		routeId: "route:fengtai-to-haidian",
		serviceKind: "commute",
	},
	{
		boardingGuide: SUBWAY_GUIDE,
		dropOffPoint: "五棵松地铁站A口（西北口）北侧200米国家开放大学东门口",
		defaultBoardingPoint: "聚雅餐厅东侧停车场路口",
		destination: "五棵松地铁站",
		displayOrder: 2,
		origin: "丰台校区",
		routeId: "route:fengtai-to-wukesong",
		serviceKind: "subway",
	},
	{
		boardingGuide: SUBWAY_GUIDE,
		dropOffPoint: "智慧中心南侧",
		defaultBoardingPoint: "五棵松地铁站A口（西北口）北侧200米国家开放大学东门口",
		destination: "丰台校区",
		displayOrder: 3,
		origin: "五棵松地铁站",
		routeId: "route:wukesong-to-fengtai",
		serviceKind: "subway",
	},
	{
		boardingGuide: SUBWAY_GUIDE,
		dropOffPoint: "篱笆房地铁站B2口",
		defaultBoardingPoint: "学生活动中心西侧停车场路口",
		destination: "篱笆房地铁站",
		displayOrder: 4,
		origin: "丰台校区",
		routeId: "route:fengtai-to-libafang",
		serviceKind: "subway",
	},
	{
		boardingGuide: SUBWAY_GUIDE,
		dropOffPoint: "学生活动中心西侧停车场路口",
		defaultBoardingPoint: "篱笆房地铁站B2口",
		destination: "丰台校区",
		displayOrder: 5,
		origin: "篱笆房地铁站",
		routeId: "route:libafang-to-fengtai",
		serviceKind: "subway",
	},
];

const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKENDS = [6, 7];

export const TRANSPORT_BASELINE_PERIODS: readonly TransportBaselinePeriod[] = [
	fixedPeriod(
		"baseline:weekday:haidian-to-fengtai",
		"route:haidian-to-fengtai",
		"2026-08-31",
		WEEKDAYS,
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
	),
	fixedPeriod(
		"baseline:weekday:fengtai-to-haidian",
		"route:fengtai-to-haidian",
		"2026-08-31",
		WEEKDAYS,
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
	),
	fixedPeriod(
		"baseline:weekend:haidian-to-fengtai",
		"route:haidian-to-fengtai",
		"2026-09-05",
		WEEKENDS,
		[
			["08:00", "teacher"],
			["12:30", "student"],
			["16:30", "teacher"],
			["18:10", "teacher"],
			["20:30", "student"],
		],
		"周六、日及法定节假日班次",
	),
	fixedPeriod(
		"baseline:weekend:fengtai-to-haidian",
		"route:fengtai-to-haidian",
		"2026-09-05",
		WEEKENDS,
		[
			["08:00", "student"],
			["12:30", "teacher"],
			["18:10", "teacher"],
		],
		"周六、日及法定节假日班次",
	),
	fixedPeriod(
		"baseline:weekend:fengtai-to-wukesong",
		"route:fengtai-to-wukesong",
		"2026-09-05",
		WEEKENDS,
		[
			["09:00", "all"],
			["09:30", "all"],
			["10:00", "all"],
			["10:30", "all"],
			["11:00", "all"],
			["11:30", "all"],
			["15:00", "all"],
			["16:00", "all"],
			["17:00", "all"],
		],
		"周六、日及法定节假日班次",
	),
	fixedPeriod(
		"baseline:weekend:wukesong-to-fengtai",
		"route:wukesong-to-fengtai",
		"2026-09-05",
		WEEKENDS,
		[
			["18:30", "all"],
			["19:30", "all"],
			["20:00", "all"],
			["20:30", "all"],
			["21:00", "all"],
			["21:30", "all"],
			["22:00", "all"],
		],
		"周六、日及法定节假日班次",
	),
	fixedPeriod(
		"baseline:weekend:fengtai-to-libafang",
		"route:fengtai-to-libafang",
		"2026-09-05",
		WEEKENDS,
		[["08:00", "all"]],
		"周六、日及法定节假日班次",
	),
	fixedPeriod(
		"baseline:weekend:libafang-to-fengtai",
		"route:libafang-to-fengtai",
		"2026-09-05",
		WEEKENDS,
		[["20:00", "all"]],
		"周六、日及法定节假日班次",
	),
	// 355867（2026-04-25）：4/28–5/5 独立安排，不外推到其他年份或假期。
	specialPeriod(
		"haidian-to-fengtai",
		[
			["08:00", "teacher"],
			["12:30", "student"],
			["16:30", "teacher"],
			["18:10", "teacher"],
			["20:30", "student"],
		],
		"东门内",
	),
	specialPeriod(
		"fengtai-to-haidian",
		[
			["08:00", "student"],
			["12:30", "teacher"],
			["18:10", "teacher"],
		],
		"聚雅餐厅东侧停车场路口",
	),
	specialPeriod(
		"fengtai-to-wukesong",
		[
			["09:00", "all"],
			["09:30", "all"],
			["10:00", "all"],
			["10:30", "all"],
			["11:00", "all"],
			["11:30", "all"],
			["15:00", "all"],
			["16:00", "all"],
		],
		"聚雅餐厅东侧停车场路口",
	),
	specialPeriod(
		"wukesong-to-fengtai",
		[
			["18:30", "all"],
			["19:30", "all"],
			["20:00", "all"],
			["20:30", "all"],
			["21:00", "all"],
			["21:30", "all"],
			["22:00", "all"],
		],
		"五棵松地铁站A口（西北口）北侧200米国家开放大学东门口",
	),
	specialPeriod("fengtai-to-libafang", [["08:00", "all"]], "学生活动中心西侧停车场路口"),
	specialPeriod("libafang-to-fengtai", [["20:00", "all"]], "篱笆房地铁站B2口"),
];

function specialPeriod(
	direction: string,
	entries: readonly [string, TransportRiderType][],
	boardingPoint: string,
): TransportBaselinePeriod {
	const period = fixedPeriod(
		`baseline:2026-may-day:${direction}`,
		`route:${direction}`,
		"2026-04-28",
		[1, 2, 3, 4, 5, 6, 7],
		entries,
		"五一期间安排",
	);
	return {
		...period,
		input: {
			...period.input,
			validTo: "2026-05-05",
			boardingPointOverride: boardingPoint,
			items: period.input.items.map((item) => ({ ...item, boardingPoint: null })),
		},
	};
}

function fixedPeriod(
	scheduleId: string,
	routeId: string,
	validFrom: string,
	weekdays: readonly number[],
	entries: readonly [string, TransportRiderType][],
	note: string | null = null,
): TransportBaselinePeriod {
	return {
		input: {
			boardingPointOverride: null,
			items: entries.map(
				([departureTime, riderType], sortOrder): TransportScheduleItem => ({
					boardingPoint:
						routeId === "route:haidian-to-fengtai"
							? riderType === "teacher"
								? "校东门内北侧"
								: "校东门内南侧"
							: null,
					capacity: null,
					departureTime,
					kind: "fixed",
					note: null,
					riderType,
					sortOrder,
				}),
			),
			note,
			routeId,
			status: "operating",
			validFrom,
			validTo: null,
			weekdays: [...weekdays],
		},
		scheduleId,
	};
}
