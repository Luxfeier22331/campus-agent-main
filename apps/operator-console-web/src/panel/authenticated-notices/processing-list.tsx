import { Alert, Button, Card, CardContent, Stack, Typography } from "@mui/material";
import {
	Datagrid,
	DateField,
	FunctionField,
	List,
	SelectInput,
	TextField,
	TextInput,
} from "react-admin";
import { Link as RouterLink } from "react-router-dom";

import { PANEL_COPY } from "../panel-copy";
import { PanelDatagridHeader } from "../panel-datagrid-header";
import { PanelListActions } from "../panel-list-actions";
import { PanelListErrorState } from "../panel-list-error";
import { PANEL_LIST_SX } from "../panel-page";
import { PanelPagination } from "../panel-pagination";
import { PanelResponsiveDatagrid } from "../panel-responsive-datagrid";
import type { AuthenticatedNoticeProcessingRecord } from "../types";
import {
	AuthenticatedNoticeCandidateChip,
	AuthenticatedNoticeFreshnessChip,
	AuthenticatedNoticeLifecycleChip,
	AuthenticatedNoticeQueueChip,
	AuthenticatedNoticeToolReadyChip,
} from "./authenticated-notice-presenters";
import { buildAuthenticatedNoticeProcessingShowPath } from "./authenticated-notice-routes";

const filters = [
	<TextInput alwaysOn key="q" label="搜索" source="q" />,
	<TextInput alwaysOn key="noticeId" label="通知 ID" source="noticeId" />,
	<SelectInput
		choices={[
			{ id: "tool_ready", name: "工具可用" },
			{ id: "materialized", name: "已更新" },
			{ id: "manual_review", name: "人工复核" },
			{ id: "failed_retryable", name: "可重试失败" },
			{ id: "failed_terminal", name: "终止失败" },
		]}
		emptyText="全部状态"
		key="status"
		label="生命周期"
		source="status"
	/>,
	<SelectInput
		choices={[
			{ id: "regulation", name: "规章制度" },
			{ id: "transport_schedule", name: "通勤班车" },
			{ id: "service_status", name: "服务状态" },
		]}
		emptyText="全部类型"
		key="candidateKind"
		label="下游类型"
		source="candidateKind"
	/>,
	<SelectInput
		choices={[
			{ id: "succeeded", name: "已成功" },
			{ id: "queued", name: "已入队" },
			{ id: "leased", name: "处理中" },
			{ id: "manual_review", name: "人工复核" },
			{ id: "failed_retryable", name: "可重试失败" },
			{ id: "failed_terminal", name: "终止失败" },
		]}
		emptyText="全部队列状态"
		key="queueStatus"
		label="队列"
		source="queueStatus"
	/>,
	<TextInput key="runId" label="运行 ID" source="runId" />,
	<TextInput key="replayBatchId" label="回放批次" source="replayBatchId" />,
];

function EmptyState() {
	return (
		<Card>
			<CardContent>
				<Stack spacing={1.5}>
					<Typography variant="h6">
						{PANEL_COPY.emptyState.authenticatedNoticeProcessing}
					</Typography>
					<Typography color="text.secondary" variant="body2">
						当前没有可查看的通知处理记录。
					</Typography>
				</Stack>
			</CardContent>
		</Card>
	);
}

function readCount(record: AuthenticatedNoticeProcessingRecord, key: string) {
	const value = record.readModelCounts[key];
	return typeof value === "number" ? value : 0;
}

export function AuthenticatedNoticeProcessingListPage() {
	return (
		<List
			actions={<PanelListActions />}
			disableSyncWithLocation
			empty={<EmptyState />}
			emptyWhileLoading
			error={
				<PanelListErrorState
					description="通知处理记录加载失败。请稍后重试，或查看服务状态。"
					title="通知处理读取失败"
				/>
			}
			filters={filters}
			pagination={<PanelPagination />}
			perPage={20}
			sort={{ field: "projectedAt", order: "DESC" }}
			sx={PANEL_LIST_SX}
			title={PANEL_COPY.menu.authenticatedNoticeProcessing}
		>
			<Stack spacing={2}>
				<Alert severity="info">查看通知处理状态、处理批次、发布状态和最近更新时间。</Alert>
				<PanelResponsiveDatagrid minWidth={1320}>
					<Datagrid
						bulkActionButtons={false}
						empty={<EmptyState />}
						header={<PanelDatagridHeader />}
					>
						<TextField label="通知 ID" source="noticeId" />
						<TextField label="标题" source="title" />
						<FunctionField
							label="生命周期"
							render={(record: AuthenticatedNoticeProcessingRecord) => (
								<AuthenticatedNoticeLifecycleChip status={record.lifecycleStatus} />
							)}
						/>
						<FunctionField
							label="队列"
							render={(record: AuthenticatedNoticeProcessingRecord) => (
								<AuthenticatedNoticeQueueChip status={record.queueStatus} />
							)}
						/>
						<FunctionField
							label="新鲜度"
							render={(record: AuthenticatedNoticeProcessingRecord) => (
								<AuthenticatedNoticeFreshnessChip status={record.freshnessStatus} />
							)}
						/>
						<FunctionField
							label="下游类型"
							render={(record: AuthenticatedNoticeProcessingRecord) => (
								<AuthenticatedNoticeCandidateChip kind={record.candidateKind} />
							)}
						/>
						<FunctionField
							label="工具"
							render={(record: AuthenticatedNoticeProcessingRecord) => (
								<AuthenticatedNoticeToolReadyChip ready={record.toolReady} />
							)}
						/>
						<FunctionField
							label="班次"
							render={(record: AuthenticatedNoticeProcessingRecord) =>
								readCount(record, "scheduledDepartures")
							}
						/>
						<FunctionField
							label="拒收源"
							render={(record: AuthenticatedNoticeProcessingRecord) =>
								readCount(record, "rejectedSources")
							}
						/>
						<TextField label="运行 ID" source="runId" />
						<DateField label="更新时间" locales="zh-CN" showTime source="projectedAt" />
						<FunctionField
							label={PANEL_COPY.view}
							render={(record: AuthenticatedNoticeProcessingRecord) => (
								<Button
									component={RouterLink}
									size="small"
									to={buildAuthenticatedNoticeProcessingShowPath(record.noticeId)}
								>
									{PANEL_COPY.view}
								</Button>
							)}
						/>
					</Datagrid>
				</PanelResponsiveDatagrid>
			</Stack>
		</List>
	);
}
