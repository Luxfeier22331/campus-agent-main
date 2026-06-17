import { Chip, Stack, Typography } from "@mui/material";

import type {
	OfficialWebArtifactRecord,
	OfficialWebPageChangeRecord,
	OfficialWebRunRecord,
	OfficialWebSiteFreshnessSummary,
	OfficialWebTargetInventoryRecord,
	OfficialWebTargetJobRecord,
} from "../types";
import {
	formatIngestionStatusLabel,
	formatOfficialWebConsumerFamilyLabel,
	formatOfficialWebFreshnessSummaryLabel,
	formatOfficialWebMaterializationPolicyLabel,
	formatOfficialWebPageChangeStatusLabel,
	formatOfficialWebRunIntentLabel,
	formatOfficialWebStatusLabel,
	formatOfficialWebTargetInventoryReviewStateLabel,
	formatOfficialWebTargetJobStatusLabel,
} from "./official-web-formatters";

function toStatusColor(status: string) {
	switch (status) {
		case "completed":
		case "dispatched":
			return "success" as const;
		case "completed_with_errors":
		case "queued":
			return "warning" as const;
		case "failed":
		case "abandoned":
		case "ingestion_failed":
			return "error" as const;
		default:
			return "default" as const;
	}
}

export function OfficialWebRunStatusChip({ status }: { status: string }) {
	return (
		<Chip color={toStatusColor(status)} label={formatOfficialWebStatusLabel(status)} size="small" />
	);
}

export function OfficialWebIngestionStatusChip({ status }: { status: string | null }) {
	return (
		<Chip
			color={toStatusColor(status ?? "default")}
			label={formatIngestionStatusLabel(status)}
			size="small"
			variant={status === "dispatched" ? "filled" : "outlined"}
		/>
	);
}

export function OfficialWebTargetJobStatusChip({ status }: { status: string }) {
	return (
		<Chip
			color={status === "active" || status === "declared" ? "success" : "default"}
			label={formatOfficialWebTargetJobStatusLabel(status)}
			size="small"
			variant={status === "active" ? "filled" : "outlined"}
		/>
	);
}

export function OfficialWebConsumerFamilyChip({ consumerFamily }: { consumerFamily: string }) {
	return (
		<Chip
			label={formatOfficialWebConsumerFamilyLabel(consumerFamily)}
			size="small"
			variant="outlined"
		/>
	);
}

export function OfficialWebMaterializationPolicyChip({
	materializationPolicy,
}: {
	materializationPolicy: string;
}) {
	return (
		<Chip
			color={materializationPolicy === "inventory_only" ? "warning" : "default"}
			label={formatOfficialWebMaterializationPolicyLabel(materializationPolicy)}
			size="small"
			variant="outlined"
		/>
	);
}

export function OfficialWebArtifactVerificationChip({
	record,
}: {
	record: OfficialWebTargetJobRecord;
}) {
	const summary = record.artifactVerificationSummary;
	if (!summary) {
		return <Chip label="暂无校验" size="small" variant="outlined" />;
	}

	return (
		<Chip
			color={summary.canonicalVerification ? "success" : "default"}
			label={summary.status}
			size="small"
			variant={summary.canonicalVerification ? "filled" : "outlined"}
		/>
	);
}

export function OfficialWebTargetInventoryReviewStateChip({
	record,
}: {
	record: OfficialWebTargetInventoryRecord;
}) {
	const state = record.reviewState;
	const color =
		state === "ready_for_selected_write"
			? ("success" as const)
			: state.startsWith("blocked_")
				? ("warning" as const)
				: state === "excluded"
					? ("error" as const)
					: state === "inventory_only"
						? ("default" as const)
						: ("info" as const);

	return (
		<Chip
			color={color}
			label={formatOfficialWebTargetInventoryReviewStateLabel(state)}
			size="small"
			variant={state === "ready_for_selected_write" ? "filled" : "outlined"}
		/>
	);
}

export function OfficialWebRunIntentChip({
	runIntent,
}: {
	runIntent: OfficialWebRunRecord["runIntent"];
}) {
	const label = formatOfficialWebRunIntentLabel(runIntent);

	return <Chip color={runIntent === "repair" ? "warning" : "default"} label={label} size="small" />;
}

export function OfficialWebHostsSummary({ hostRoots }: { hostRoots: string[] }) {
	return (
		<Typography variant="body2">
			{hostRoots.length > 0 ? hostRoots.join(", ") : "暂无已登记主机"}
		</Typography>
	);
}

export function OfficialWebFailureSummary({ record }: { record: OfficialWebRunRecord }) {
	return <Typography variant="body2">{record.failureCount}</Typography>;
}

export function OfficialWebArtifactList({ artifacts }: { artifacts: OfficialWebArtifactRecord[] }) {
	if (artifacts.length === 0) {
		return (
			<Typography color="text.secondary" variant="body2">
				暂无已登记产物。
			</Typography>
		);
	}

	return (
		<Stack spacing={1}>
			{artifacts.map((artifact) => (
				<Stack key={`${artifact.artifactType}:${artifact.objectKey}`} spacing={0.25}>
					<Typography variant="body2">
						<strong>{artifact.artifactType}</strong>
					</Typography>
					<Typography color="text.secondary" sx={{ wordBreak: "break-all" }} variant="caption">
						{artifact.objectKey}
					</Typography>
				</Stack>
			))}
		</Stack>
	);
}

export function OfficialWebPageChangeChip({ change }: { change: OfficialWebPageChangeRecord }) {
	return (
		<Chip
			color={
				change.changeStatus === "changed" || change.changeStatus === "new"
					? "warning"
					: change.changeStatus === "deleted" || change.changeStatus === "fetch_failed"
						? "error"
						: "default"
			}
			label={formatOfficialWebPageChangeStatusLabel(change.changeStatus)}
			size="small"
			variant={change.changeStatus === "fetch_failed" ? "filled" : "outlined"}
		/>
	);
}

export function OfficialWebFreshnessSummaryGrid({
	summary,
}: {
	summary: OfficialWebSiteFreshnessSummary;
}) {
	const rows = [
		[formatOfficialWebFreshnessSummaryLabel("totalPages"), summary.totalPages],
		[formatOfficialWebFreshnessSummaryLabel("duePages"), summary.duePages],
		[formatOfficialWebFreshnessSummaryLabel("hotPages"), summary.hotPages],
		[formatOfficialWebFreshnessSummaryLabel("repairPages"), summary.repairPages],
		[formatOfficialWebFreshnessSummaryLabel("failedFetchPages"), summary.failedFetchPages],
		[formatOfficialWebFreshnessSummaryLabel("changedLast24h"), summary.changedLast24h],
		[formatOfficialWebFreshnessSummaryLabel("deletedPages"), summary.deletedPages],
	] as const;

	return (
		<Stack
			sx={{
				display: "grid",
				gap: 1,
				gridTemplateColumns: {
					md: "repeat(3, minmax(0, 1fr))",
					xs: "repeat(2, minmax(0, 1fr))",
				},
			}}
		>
			{rows.map(([label, value]) => (
				<Stack
					key={label}
					spacing={0.25}
					sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, p: 1.5 }}
				>
					<Typography color="text.secondary" variant="caption">
						{label}
					</Typography>
					<Typography variant="h6">{value}</Typography>
				</Stack>
			))}
		</Stack>
	);
}
