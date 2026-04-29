import { Chip, Stack, Typography } from "@mui/material";
import { PANEL_COPY } from "../panel-copy";
import type { RequestProjectionRecord } from "../types";
import {
	buildRequestOutcomeBadges,
	formatPrincipalTypeLabel,
	formatRequestOutcomeDetail,
	formatScope,
	formatSelectedTargetLabel,
	formatStatusLabel,
	formatSurfaceLabel,
} from "./request-formatters";

function statusChipColor(status: string): "default" | "error" | "info" | "success" | "warning" {
	switch (status) {
		case "completed":
			return "success";
		case "needs_clarification":
		case "approval_required":
			return "warning";
		case "rejected":
		case "error":
			return "error";
		case "accepted":
			return "info";
		default:
			return "default";
	}
}

export function RequestStatusChip({ status }: { status: string }) {
	const color = statusChipColor(status);
	return (
		<Chip
			color={color}
			label={formatStatusLabel(status)}
			size="small"
			variant={color === "default" ? "outlined" : "filled"}
		/>
	);
}

export function RequestActorSummary({ record }: { record: RequestProjectionRecord }) {
	const secondaryParts = [
		formatPrincipalTypeLabel(record.principalType),
		record.principalId,
	].filter(Boolean);

	return (
		<Stack spacing={0.25}>
			<Typography fontWeight={500} variant="body2">
				{record.principalLabel || PANEL_COPY.unnamedPrincipal}
			</Typography>
			<Typography color="text.secondary" variant="caption">
				{secondaryParts.join(" · ")}
			</Typography>
		</Stack>
	);
}

export function RequestPreviewText({
	emptyText,
	maxLines = 3,
	text,
	variant = "body2",
}: {
	emptyText: string;
	maxLines?: number;
	text: string | null;
	variant?: "body2" | "caption";
}) {
	if (!text?.trim()) {
		return (
			<Typography color="text.secondary" variant={variant}>
				{emptyText}
			</Typography>
		);
	}

	return (
		<Typography
			sx={{
				WebkitBoxOrient: "vertical",
				WebkitLineClamp: maxLines,
				display: "-webkit-box",
				overflow: "hidden",
				whiteSpace: "normal",
			}}
			variant={variant}
		>
			{text}
		</Typography>
	);
}

export function RequestScopeSummary({ record }: { record: RequestProjectionRecord }) {
	return (
		<Stack spacing={0.25}>
			<Typography fontWeight={500} variant="body2">
				{formatSelectedTargetLabel(record.selectedTarget)}
			</Typography>
			<Typography color="text.secondary" variant="caption">
				{formatScope(record.requestedScope)}
			</Typography>
		</Stack>
	);
}

export function RequestSurfaceLabel({ surface }: { surface: string }) {
	return <Typography variant="body2">{formatSurfaceLabel(surface)}</Typography>;
}

export function RequestSourceDocumentChips({ sourceDocIds }: { sourceDocIds: string[] }) {
	const uniqueSourceDocIds = [...new Set(sourceDocIds)];

	if (uniqueSourceDocIds.length === 0) {
		return (
			<Typography color="text.secondary" variant="body2">
				{PANEL_COPY.noSourceDocumentsCaptured}
			</Typography>
		);
	}

	return (
		<Stack direction="row" flexWrap="wrap" gap={1}>
			{uniqueSourceDocIds.map((docId) => (
				<Chip key={docId} label={docId} size="small" variant="outlined" />
			))}
		</Stack>
	);
}

export function RequestOutcomeSummary({ record }: { record: RequestProjectionRecord }) {
	const badges = buildRequestOutcomeBadges(record);
	const detail = formatRequestOutcomeDetail(record);

	return (
		<Stack spacing={0.75}>
			<Stack direction="row" flexWrap="wrap" gap={0.75}>
				{badges.map((badge) => (
					<Chip
						color={badge.color}
						key={`${badge.color}:${badge.label}`}
						label={badge.label}
						size="small"
						variant={badge.color === "default" ? "outlined" : "filled"}
					/>
				))}
			</Stack>
			<RequestPreviewText
				emptyText={PANEL_COPY.requestsList.outcome.noDetail}
				maxLines={2}
				text={detail}
				variant="caption"
			/>
		</Stack>
	);
}
