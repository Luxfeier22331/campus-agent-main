import { Alert, Card, CardContent, Stack, Typography } from "@mui/material";
import {
	Datagrid,
	DateField,
	FunctionField,
	List,
	SelectInput,
	ShowButton,
	TextField,
	TextInput,
} from "react-admin";

import { PANEL_COPY } from "../panel-copy";
import { PanelDatagridHeader } from "../panel-datagrid-header";
import { PanelListActions } from "../panel-list-actions";
import { PanelListErrorState } from "../panel-list-error";
import { PanelPagination } from "../panel-pagination";
import { PanelResponsiveDatagrid } from "../panel-responsive-datagrid";
import type { OfficialWebRunRecord } from "../types";
import { formatOfficialWebRunIntentLabel } from "./official-web-formatters";
import {
	OfficialWebFailureSummary,
	OfficialWebIngestionStatusChip,
	OfficialWebRunIntentChip,
	OfficialWebRunStatusChip,
} from "./official-web-presenters";

const runFilters = [
	<TextInput alwaysOn key="siteId" label="站点 ID" source="siteId" />,
	<SelectInput
		choices={[
			{ id: "baseline", name: formatOfficialWebRunIntentLabel("baseline") },
			{ id: "hot", name: formatOfficialWebRunIntentLabel("hot") },
			{ id: "repair", name: formatOfficialWebRunIntentLabel("repair") },
		]}
		emptyText="全部意图"
		key="runIntent"
		label="运行意图"
		source="runIntent"
	/>,
	<SelectInput
		choices={[
			{ id: "accepted", name: PANEL_COPY.officialWebStatus.accepted },
			{ id: "running", name: PANEL_COPY.officialWebStatus.running },
			{ id: "completed", name: PANEL_COPY.officialWebStatus.completed },
			{ id: "completed_with_errors", name: PANEL_COPY.officialWebStatus.completed_with_errors },
			{ id: "failed", name: PANEL_COPY.officialWebStatus.failed },
			{ id: "abandoned", name: PANEL_COPY.officialWebStatus.abandoned },
		]}
		emptyText="全部状态"
		key="status"
		label="状态"
		source="status"
	/>,
	<SelectInput
		choices={[
			{ id: "pending", name: PANEL_COPY.ingestionStatus.pending },
			{ id: "queued", name: PANEL_COPY.ingestionStatus.queued },
			{ id: "dispatched", name: PANEL_COPY.ingestionStatus.dispatched },
			{ id: "ingestion_failed", name: PANEL_COPY.ingestionStatus.ingestion_failed },
		]}
		emptyText="全部分发状态"
		key="ingestionDispatchStatus"
		label="分发"
		source="ingestionDispatchStatus"
	/>,
];

function OfficialWebRunsContractNotice() {
	return (
		<Alert severity="info">
			采集运行列表读取 app-api 维护的投影视图。游标分页按设计只能顺序前进，不会绕过运行时边界。
		</Alert>
	);
}

function OfficialWebRunsEmpty() {
	return (
		<Card>
			<CardContent>
				<Stack spacing={1.5}>
					<Typography variant="h6">{PANEL_COPY.emptyState.officialWebRuns}</Typography>
					<Typography color="text.secondary" variant="body2">
						该列表只展示 app-api 已物化的官网采集运行投影。若当前 staging
						尚未回放样本运行或投影未完成，这里会保持为空。
					</Typography>
				</Stack>
			</CardContent>
		</Card>
	);
}

export function OfficialWebRunsListPage() {
	return (
		<List
			actions={<PanelListActions />}
			empty={<OfficialWebRunsEmpty />}
			emptyWhileLoading
			error={
				<PanelListErrorState
					description="官网采集运行页读取的是 app-api 已物化的运行投影；如果查询失败，面板会直接显示后端错误，而不是退化成空态。"
					title="官网采集运行读取失败"
				/>
			}
			filters={runFilters}
			pagination={<PanelPagination />}
			perPage={20}
			sort={{ field: "startedAt", order: "DESC" }}
			title="官网采集运行"
		>
			<Stack spacing={2}>
				<OfficialWebRunsContractNotice />
				<PanelResponsiveDatagrid minWidth={1080}>
					<Datagrid
						bulkActionButtons={false}
						empty={<OfficialWebRunsEmpty />}
						header={<PanelDatagridHeader />}
						rowClick="show"
					>
						<TextField label="运行 ID" source="runId" />
						<TextField label="站点" source="siteId" />
						<FunctionField
							label="运行意图"
							render={(record: OfficialWebRunRecord) => (
								<OfficialWebRunIntentChip runIntent={record.runIntent} />
							)}
						/>
						<FunctionField
							label="状态"
							render={(record: OfficialWebRunRecord) => (
								<OfficialWebRunStatusChip status={record.status} />
							)}
						/>
						<FunctionField
							label="分发"
							render={(record: OfficialWebRunRecord) => (
								<OfficialWebIngestionStatusChip status={record.ingestionDispatchStatus} />
							)}
						/>
						<FunctionField
							label="执行"
							render={(record: OfficialWebRunRecord) => (
								<OfficialWebIngestionStatusChip status={record.ingestionExecutionStatus} />
							)}
						/>
						<FunctionField
							label="失败数"
							render={(record: OfficialWebRunRecord) => (
								<OfficialWebFailureSummary record={record} />
							)}
						/>
						<DateField label="开始时间" locales="zh-CN" showTime source="startedAt" />
						<DateField label="结束时间" locales="zh-CN" showTime source="finishedAt" />
						<ShowButton label={PANEL_COPY.view} />
					</Datagrid>
				</PanelResponsiveDatagrid>
			</Stack>
		</List>
	);
}
