export { fetchStatusSnapshot, STATUS_REQUEST_TIMEOUT_MS } from "./status-client.js";
export {
	formatDateTime,
	formatDayLabel,
	formatRelativeTime,
	isSnapshotExpired,
	parseDate,
	STATUS_LABELS,
	STATUS_SUMMARY_LABELS,
	STATUS_TIME_ZONE,
	statusCalendarDay,
	timelineCounts,
	timelineDays,
	timelineSummary,
	validStatus,
} from "./status-model.js";
export { initStatusPage } from "./status-page-controller.js";

import { initStatusPage } from "./status-page-controller.js";

if (typeof document !== "undefined") {
	initStatusPage();
}
