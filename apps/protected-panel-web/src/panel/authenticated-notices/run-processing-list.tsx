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
import type { AuthenticatedNoticeRunProcessingRecord } from "../types";
import {
	AuthenticatedNoticeFreshnessChip,
	AuthenticatedNoticeLifecycleChip,
	AuthenticatedNoticeQueueChip,
} from "./authenticated-notice-presenters";
import { buildAuthenticatedNoticeRunProcessingShowPath } from "./authenticated-notice-routes";

const filters = [
	<TextInput alwaysOn key="q" label="搜索" source="q" />,
	<TextInput alwaysOn key="collectorRunToken" label="采集 run token" source="collectorRunToken" />,
	<SelectInput
		choices={[
			{ id: "succeeded", name: "已成功" },
			{ id: "mixed_terminal", name: "混合终态" },
			{ id: "active", name: "处理中" },
			{ id: "manual_review", name: "人工复核" },
			{ id: "failed_terminal", name: "终止失败" },
			{ id: "cancelled", name: "已取消" },
		]}
		emptyText="全部状态"
		key="status"
		label="生命周期"
		source="status"
	/>,
	<SelectInput
		choices={[
			{ id: "succeeded", name: "已成功" },
			{ id: "queued", name: "已入队" },
			{ id: "leased", name: "处理中" },
			{ id: "manual_review", name: "人工复核" },
			{ id: "failed_retryable", name: "可重试失败" },
			{ id: "failed_terminal", name: "终止失败" },
			{ id: "cancelled", name: "已取消" },
		]}
		emptyText="全部队列状态"
		key="queueStatus"
		label="最新队列"
		source="queueStatus"
	/>,
	<TextInput key="siteId" label="站点" source="siteId" />,
	<TextInput key="sourceSurface" label="来源面" source="sourceSurface" />,
	<TextInput key="runId" label="运行 ID" source="runId" />,
	<TextInput key="replayBatchId" label="回放批次" source="replayBatchId" />,
];

function EmptyState() {
	return (
		<Card>
			<CardContent>
				<Stack spacing={1.5}>
					<Typography variant="h6">
						{PANEL_COPY.emptyState.authenticatedNoticeRunProcessing}
					</Typography>
					<Typography color="text.secondary" variant="body2">
						这里展示 collector run / replay batch / queue run 的安全聚合投影；只有 app-api 接收到
						run-level snapshot 后才会出现。
					</Typography>
				</Stack>
			</CardContent>
		</Card>
	);
}

function countValue(record: AuthenticatedNoticeRunProcessingRecord, key: string) {
	const value = record.queueStatusCounts[key];
	return typeof value === "number" ? value : 0;
}

export function AuthenticatedNoticeRunProcessingListPage() {
	return (
		<List
			actions={<PanelListActions />}
			disableSyncWithLocation
			empty={<EmptyState />}
			emptyWhileLoading
			error={
				<PanelListErrorState
					description="通知 run 处理页读取的是 app-api 的安全投影；如果查询失败，面板不会回退到队列表、对象存储或 trace 文件。"
					title="通知 run 处理读取失败"
				/>
			}
			filters={filters}
			pagination={<PanelPagination />}
			perPage={20}
			sort={{ field: "projectedAt", order: "DESC" }}
			sx={PANEL_LIST_SX}
			title={PANEL_COPY.menu.authenticatedNoticeRunProcessing}
		>
			<Stack spacing={2}>
				<Alert severity="info">
					该视图只展示 app-api 持有的 run-level operator-safe
					projection：不暴露队列表、对象存储、trace 文件或通知正文。
				</Alert>
				<PanelResponsiveDatagrid minWidth={1280}>
					<Datagrid
						bulkActionButtons={false}
						empty={<EmptyState />}
						header={<PanelDatagridHeader />}
					>
						<TextField label="采集 run token" source="collectorRunToken" />
						<TextField label="站点" source="siteId" />
						<FunctionField
							label="生命周期"
							render={(record: AuthenticatedNoticeRunProcessingRecord) => (
								<AuthenticatedNoticeLifecycleChip status={record.lifecycleStatus} />
							)}
						/>
						<FunctionField
							label="最新队列"
							render={(record: AuthenticatedNoticeRunProcessingRecord) => (
								<AuthenticatedNoticeQueueChip status={record.latestQueueStatus} />
							)}
						/>
						<FunctionField
							label="新鲜度"
							render={(record: AuthenticatedNoticeRunProcessingRecord) => (
								<AuthenticatedNoticeFreshnessChip status={record.freshnessStatus} />
							)}
						/>
						<TextField label="队列任务" source="queueJobCount" />
						<FunctionField
							label="成功"
							render={(record: AuthenticatedNoticeRunProcessingRecord) =>
								countValue(record, "succeeded")
							}
						/>
						<FunctionField
							label="终止失败"
							render={(record: AuthenticatedNoticeRunProcessingRecord) =>
								countValue(record, "failed_terminal")
							}
						/>
						<TextField label="来源面" source="sourceSurface" />
						<TextField label="运行 ID" source="runId" />
						<DateField label="投影时间" locales="zh-CN" showTime source="projectedAt" />
						<FunctionField
							label={PANEL_COPY.view}
							render={(record: AuthenticatedNoticeRunProcessingRecord) => (
								<Button
									component={RouterLink}
									size="small"
									to={buildAuthenticatedNoticeRunProcessingShowPath(record.id)}
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
