import { Chip } from "@mui/material";

import {
	formatAuthenticatedNoticeCandidateKindLabel,
	formatAuthenticatedNoticeLifecycleLabel,
	formatAuthenticatedNoticeQueueStatusLabel,
} from "./authenticated-notice-formatters";

function lifecycleColor(status: string | null) {
	switch (status) {
		case "tool_ready":
		case "materialized":
		case "succeeded":
			return "success" as const;
		case "manual_review":
		case "failed_retryable":
			return "warning" as const;
		case "failed_terminal":
		case "dead_letter":
			return "error" as const;
		default:
			return "default" as const;
	}
}

export function AuthenticatedNoticeLifecycleChip({ status }: { status: string | null }) {
	return (
		<Chip
			color={lifecycleColor(status)}
			label={formatAuthenticatedNoticeLifecycleLabel(status)}
			size="small"
		/>
	);
}

export function AuthenticatedNoticeQueueChip({ status }: { status: string | null }) {
	return (
		<Chip
			color={lifecycleColor(status)}
			label={formatAuthenticatedNoticeQueueStatusLabel(status)}
			size="small"
			variant={status === "succeeded" ? "filled" : "outlined"}
		/>
	);
}

export function AuthenticatedNoticeCandidateChip({ kind }: { kind: string | null }) {
	return (
		<Chip
			color={kind === "transport_schedule" ? "info" : "default"}
			label={formatAuthenticatedNoticeCandidateKindLabel(kind)}
			size="small"
			variant="outlined"
		/>
	);
}

export function AuthenticatedNoticeToolReadyChip({ ready }: { ready: boolean }) {
	return (
		<Chip
			color={ready ? "success" : "default"}
			label={ready ? "工具可用" : "未就绪"}
			size="small"
			variant={ready ? "filled" : "outlined"}
		/>
	);
}
