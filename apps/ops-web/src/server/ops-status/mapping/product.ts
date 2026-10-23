import type { OpsRequestDetailResponse, OpsRequestSummary } from "../../../shared/ops-contract.ts";
import { normalizeProductSources } from "../../chat-source-mapping.ts";
import type { OpsRequestDetailRow, OpsRequestRow } from "../store/types.ts";
import { isTerminalRequestStatus, normalizeAssistantKind } from "./values.ts";
export function toResultSummary(
	row: Pick<OpsRequestRow, "assistantKind" | "assistantMessagePresent">,
	status: OpsRequestSummary["status"],
): OpsRequestSummary["result"] {
	if (row.assistantMessagePresent) {
		return { kind: normalizeAssistantKind(row.assistantKind), state: "WRITTEN" };
	}
	return isTerminalRequestStatus(status)
		? { kind: null, state: "MISSING" }
		: { kind: null, state: "PENDING" };
}

export function toProductResult(
	row: OpsRequestDetailRow,
	status: OpsRequestSummary["status"],
	campusWebPublicOrigin?: string,
): OpsRequestDetailResponse["result"] {
	if (row.assistantMessagePresent) {
		if (row.assistantMessageText === null) {
			throw new Error("Assistant message is present without text");
		}
		return {
			kind: normalizeAssistantKind(row.assistantKind),
			sources: normalizeProductSources(row.assistantStructuredPartsJson, campusWebPublicOrigin),
			state: "WRITTEN",
			text: row.assistantMessageText,
		};
	}
	return isTerminalRequestStatus(status)
		? { reasonCode: "ASSISTANT_MESSAGE_MISSING", state: "MISSING" }
		: { state: "PENDING" };
}
