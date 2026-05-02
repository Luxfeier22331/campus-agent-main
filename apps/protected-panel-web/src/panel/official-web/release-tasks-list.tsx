import { Alert, Button, Card, CardContent, Chip, Stack, Typography } from "@mui/material";
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
import type { OfficialWebReleaseTaskRecord } from "../types";
import { buildOfficialWebReleaseTaskShowPath } from "./official-web-routes";

const filters = [
	<TextInput alwaysOn key="q" label="搜索" source="q" />,
	<TextInput alwaysOn key="inventoryId" label="清单 ID" source="inventoryId" />,
	<TextInput key="jobId" label="目标任务" source="jobId" />,
	<TextInput key="runId" label="运行 ID" source="runId" />,
	<SelectInput
		choices={[
			{ id: "queued", name: "已排队" },
			{ id: "claimed", name: "已认领" },
			{ id: "running", name: "运行中" },
			{ id: "materialized", name: "已物化" },
			{ id: "published", name: "已发布" },
			{ id: "indexed", name: "已索引" },
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
			{
				id: "official_web_selected_write_contact_directory",
				name: "联系信息选择写",
			},
			{
				id: "official_web_selected_write_service_guide",
				name: "办事指南选择写",
			},
			{ id: "official_web_stable_reference", name: "稳定参考" },
		]}
		emptyText="全部类型"
		key="taskType"
		label="任务类型"
		source="taskType"
	/>,
	<TextInput key="selectedWriteTarget" label="选择写目标" source="selectedWriteTarget" />,
];

function EmptyState() {
	return (
		<Card>
			<CardContent>
				<Stack spacing={1.5}>
					<Typography variant="h6">{PANEL_COPY.emptyState.officialWebReleaseTasks}</Typography>
					<Typography color="text.secondary" variant="body2">
						这里展示 ingestion-worker 回报给 app-api 的发布任务安全投影。
					</Typography>
				</Stack>
			</CardContent>
		</Card>
	);
}

function ReleaseTaskStatusChip({ status }: { status: string }) {
	const color =
		status === "published" || status === "indexed"
			? ("success" as const)
			: status === "failed_retryable" || status === "materialized"
				? ("warning" as const)
				: status === "failed_terminal"
					? ("error" as const)
					: ("default" as const);
	return <Chip color={color} label={status} size="small" variant="outlined" />;
}

export function OfficialWebReleaseTasksListPage() {
	return (
		<List
			actions={<PanelListActions />}
			disableSyncWithLocation
			empty={<EmptyState />}
			emptyWhileLoading
			error={
				<PanelListErrorState
					description="官网发布任务页只读取 app-api 的 operator-safe projection；如果查询失败，面板不会直接访问 ingestion 队列表。"
					title="官网发布任务读取失败"
				/>
			}
			filters={filters}
			pagination={<PanelPagination />}
			perPage={20}
			sort={{ field: "projectedAt", order: "DESC" }}
			sx={PANEL_LIST_SX}
			title={PANEL_COPY.menu.officialWebReleaseTasks}
		>
			<Stack spacing={2}>
				<Alert severity="info">
					该视图只展示发布任务投影：不暴露 source-truth object key、bucket、原始 HTML 或执行栈。
				</Alert>
				<PanelResponsiveDatagrid minWidth={1280}>
					<Datagrid
						bulkActionButtons={false}
						empty={<EmptyState />}
						header={<PanelDatagridHeader />}
					>
						<TextField label="任务 ID" source="taskId" />
						<TextField label="清单 ID" source="inventoryId" />
						<FunctionField
							label="生命周期"
							render={(record: OfficialWebReleaseTaskRecord) => (
								<ReleaseTaskStatusChip status={record.lifecycleStatus} />
							)}
						/>
						<TextField label="最新阶段" source="latestStage" />
						<TextField label="任务类型" source="taskType" />
						<TextField label="选择写目标" source="selectedWriteTarget" />
						<TextField label="尝试" source="attemptCount" />
						<TextField label="运行 ID" source="runId" />
						<DateField label="投影时间" locales="zh-CN" showTime source="projectedAt" />
						<FunctionField
							label={PANEL_COPY.view}
							render={(record: OfficialWebReleaseTaskRecord) => (
								<Button
									component={RouterLink}
									size="small"
									to={buildOfficialWebReleaseTaskShowPath(record.id)}
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
