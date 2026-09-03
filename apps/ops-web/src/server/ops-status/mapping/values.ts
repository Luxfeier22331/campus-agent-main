import type { OpsRequestSummary } from "../../../shared/ops-contract.ts";
import type { OpsRequestRow, OpsRequestSummaryTotals } from "../store/types.ts";

const TERMINAL_STATUSES = new Set<OpsRequestSummary["status"]>([
	"COMPLETED",
	"FAILED",
	"CANCELLED",
	"ACTION_REQUIRED",
]);

export function isTerminalRequestStatus(status: OpsRequestSummary["status"]): boolean {
	return TERMINAL_STATUSES.has(status);
}

export function normalizeAssistantKind(value: unknown): "answer" | "error" {
	if (value === "answer" || value === "error") {
		return value;
	}
	throw new Error("Assistant message kind is invalid");
}

export function normalizeAttentionReason(value: unknown): OpsRequestSummary["attentionReason"] {
	return value === "RESULT_MISSING" ||
		value === "REQUEST_FAILED" ||
		value === "EXECUTION_STAGE_FAILED" ||
		value === "WAITING_USER"
		? value
		: null;
}

export function normalizeRequestStatus(value: string): OpsRequestSummary["status"] {
	const normalized = value.trim().toUpperCase();
	if (TERMINAL_STATUSES.has(normalized as OpsRequestSummary["status"])) {
		return normalized as OpsRequestSummary["status"];
	}
	if (normalized === "RUNNING") {
		return "RUNNING";
	}
	if (normalized === "PENDING") {
		return "PENDING";
	}
	if (normalized === "ERROR" || normalized === "REJECTED") {
		return "FAILED";
	}
	if (normalized === "ACCEPTED") {
		return "PENDING";
	}
	if (normalized === "APPROVAL_REQUIRED") {
		return "ACTION_REQUIRED";
	}
	if (normalized === "COMPLETED" || normalized === "COMPLETE") {
		return "COMPLETED";
	}
	throw new Error(`Unsupported request projection status: ${value}`);
}

export function deriveRequestLifecyclePhase(
	row: OpsRequestRow,
	status: OpsRequestSummary["status"],
): OpsRequestSummary["lifecyclePhase"] {
	if (isTerminalRequestStatus(status)) {
		return "FINISHED";
	}
	const runStatus = normalizeNullableString(row.runStatus)?.toLowerCase();
	if (runStatus === "streaming") {
		return "STREAMING";
	}
	if (runStatus === "running") {
		return "RUNNING";
	}
	if (
		runStatus &&
		["completed", "failed", "expired", "canceled", "cancelled"].includes(runStatus)
	) {
		return "FINALIZING";
	}
	if (runStatus && ["created", "queued", "admitted"].includes(runStatus)) {
		return "QUEUED";
	}
	return status === "PENDING" ? "QUEUED" : "RUNNING";
}

export function requestSearchText(request: OpsRequestSummary): string {
	return [request.requestId, request.question.preview].join(" ").toLowerCase();
}

export function normalizeStatusToDb(value: string | undefined): string | undefined {
	return normalizeStatusToDbValues(value)[0];
}

export function normalizeStatusToDbValues(value: string | undefined): string[] {
	if (!value) {
		return [];
	}
	if (value === "COMPLETED") {
		return ["completed"];
	}
	if (value === "FAILED") {
		return ["error", "rejected"];
	}
	if (value === "CANCELLED") {
		return ["cancelled"];
	}
	if (value === "PENDING") {
		return ["accepted"];
	}
	if (value === "ACTION_REQUIRED") {
		return ["approval_required"];
	}
	if (value === "RUNNING") {
		return ["running"];
	}
	return [];
}

export function normalizeDbStatusToSummaryKey(
	status: string,
): Exclude<keyof OpsRequestSummaryTotals, "total"> {
	const summaryKeys = {
		action_required: "actionRequired",
		cancelled: "cancelled",
		completed: "completed",
		error: "failed",
		accepted: "pending",
		approval_required: "actionRequired",
		rejected: "failed",
		running: "running",
	} as const;
	const normalized = status.trim().toLowerCase();
	const summaryKey = summaryKeys[normalized as keyof typeof summaryKeys];
	if (!summaryKey) {
		throw new Error(`Unsupported request projection status: ${status}`);
	}
	return summaryKey;
}

export function readMetricMs(value: unknown): number {
	if (!isRecord(value)) {
		return 0;
	}
	return readNonNegativeInteger(value.ms, 0);
}

export function readMetricCount(value: unknown, key: string): number {
	if (!isRecord(value)) {
		return 0;
	}
	return readNonNegativeInteger(value[key], 0);
}

export function normalizeNullableString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function readNonNegativeInteger(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

export function readNullableNonNegativeInteger(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
