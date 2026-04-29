import { PANEL_COPY } from "../../panel-copy";
import {
	CURRENT_RUNTIME_TARGET_OPTIONS,
	formatSurfaceLabel,
} from "../../requests/request-formatters";
import type { OperatorOverviewWindow } from "../../types";

export interface OverviewFilterState {
	selectedTarget: string | null;
	surface: string | null;
	window: OperatorOverviewWindow;
}

export const OVERVIEW_WINDOW_OPTIONS: Array<{
	label: string;
	value: OperatorOverviewWindow;
}> = [
	{ label: "15 分钟", value: "15m" },
	{ label: "1 小时", value: "1h" },
	{ label: "24 小时", value: "24h" },
	{ label: "7 天", value: "7d" },
	{ label: "30 天", value: "30d" },
];

export const SURFACE_OPTIONS: Array<{ label: string; value: string | null }> = [
	{ label: PANEL_COPY.overviewPage.filters.allSurfaces, value: null },
	{ label: formatSurfaceLabel("public_chat_web"), value: "public_chat_web" },
	{ label: formatSurfaceLabel("protected_panel_web"), value: "protected_panel_web" },
];

export const TARGET_OPTIONS: Array<{ label: string; value: string | null }> = [
	{ label: PANEL_COPY.overviewPage.filters.allTargets, value: null },
	...CURRENT_RUNTIME_TARGET_OPTIONS,
];
