import { PANEL_COPY } from "../../panel-copy";
import {
	CURRENT_RUNTIME_TARGET_OPTIONS,
	formatSurfaceLabel,
} from "../../requests/request-formatters";
import type { OperatorOverviewWindow } from "../../types";
import { formatQualityBadcaseStatus } from "../quality-domain";

export interface QualityFilterState {
	badcaseCauseClass: string;
	badcaseDetectedBy: string;
	badcaseStatus: string;
	evalPage: number;
	page: number;
	perPage: number;
	selectedCapability: string | null;
	surface: string | null;
	window: OperatorOverviewWindow;
}

export const QUALITY_WINDOW_OPTIONS: Array<{
	label: string;
	value: OperatorOverviewWindow;
}> = [
	{ label: "15 分钟", value: "15m" },
	{ label: "1 小时", value: "1h" },
	{ label: "24 小时", value: "24h" },
	{ label: "7 天", value: "7d" },
	{ label: "30 天", value: "30d" },
];

export const QUALITY_SURFACE_OPTIONS: Array<{ label: string; value: string | null }> = [
	{ label: PANEL_COPY.overviewPage.filters.allSurfaces, value: null },
	{ label: formatSurfaceLabel("public_chat_web"), value: "public_chat_web" },
	{ label: formatSurfaceLabel("operator_console_web"), value: "operator_console_web" },
	{ label: "学生规章", value: "regulations/student_rules" },
	{ label: "校级制度", value: "regulations/institutional_rules" },
	{ label: "培养方案", value: "curriculum/curriculum_plan" },
	{ label: "稳定官网参考", value: "official_web/stable_reference" },
];

export const QUALITY_TARGET_OPTIONS: Array<{ label: string; value: string | null }> = [
	{ label: PANEL_COPY.overviewPage.filters.allTargets, value: null },
	...CURRENT_RUNTIME_TARGET_OPTIONS,
];

export const BADCASE_STATUS_OPTIONS = [
	{ label: PANEL_COPY.qualityPage.filters.allStatuses, value: "" },
	{ label: formatQualityBadcaseStatus("open"), value: "open" },
	{ label: formatQualityBadcaseStatus("closed"), value: "closed" },
];

export const QUALITY_PAGE_SIZE_OPTIONS = [10, 20, 50];
