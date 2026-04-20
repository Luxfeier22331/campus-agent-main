import { PANEL_COPY } from "../../panel-copy";
import {
  formatSelectedTargetLabel,
  formatSurfaceLabel,
} from "../../requests/request-formatters";
import type { OperatorOverviewWindow } from "../../types";
import { formatQualityBadcaseStatus } from "../quality-domain";

export type QualityFilterState = {
  badcaseCauseClass: string;
  badcaseDetectedBy: string;
  badcaseStatus: string;
  page: number;
  perPage: number;
  selectedTarget: string | null;
  surface: string | null;
  window: OperatorOverviewWindow;
};

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
  { label: formatSurfaceLabel("protected_panel_web"), value: "protected_panel_web" },
];

export const QUALITY_TARGET_OPTIONS: Array<{ label: string; value: string | null }> = [
  { label: PANEL_COPY.overviewPage.filters.allTargets, value: null },
  { label: formatSelectedTargetLabel("rag-specialist"), value: "rag-specialist" },
];

export const BADCASE_STATUS_OPTIONS = [
  { label: PANEL_COPY.qualityPage.filters.allStatuses, value: "" },
  { label: formatQualityBadcaseStatus("open"), value: "open" },
  { label: formatQualityBadcaseStatus("closed"), value: "closed" },
];

export const QUALITY_PAGE_SIZE_OPTIONS = [10, 20, 50];
