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
import type { OfficialWebTargetJobRecord } from "../types";
import {
	OfficialWebArtifactVerificationChip,
	OfficialWebConsumerFamilyChip,
	OfficialWebMaterializationPolicyChip,
	OfficialWebTargetJobStatusChip,
} from "./official-web-presenters";
import { buildOfficialWebTargetJobShowPath } from "./official-web-routes";

const targetJobFilters = [
	<TextInput alwaysOn key="siteId" label="站点 ID" source="siteId" />,
	<TextInput alwaysOn key="targetId" label="目标 ID" source="targetId" />,
	<SelectInput
		choices={[
			{ id: "declared", name: "已声明" },
			{ id: "active", name: "活跃" },
			{ id: "disabled", name: "已停用" },
		]}
		emptyText="全部状态"
		key="status"
		label="状态"
		source="status"
	/>,
];

function OfficialWebTargetJobsContractNotice() {
	return (
		<Alert severity="info">
			目标任务读取 app-api 的 operator 投影，只展示 target lineage、候选 URL、尝试计数和校验摘要。
		</Alert>
	);
}

function OfficialWebTargetJobsEmpty() {
	return (
		<Card>
			<CardContent>
				<Stack spacing={1.5}>
					<Typography variant="h6">{PANEL_COPY.emptyState.officialWebTargetJobs}</Typography>
					<Typography color="text.secondary" variant="body2">
						这里不会从对象存储或采集器本地目录推导任务。没有 app-api target job 投影时保持为空。
					</Typography>
				</Stack>
			</CardContent>
		</Card>
	);
}

export function OfficialWebTargetJobsListPage() {
	return (
		<List
			actions={<PanelListActions />}
			disableSyncWithLocation
			empty={<OfficialWebTargetJobsEmpty />}
			emptyWhileLoading
			error={
				<PanelListErrorState
					description="目标任务页只读取 app-api 已物化的 target-first 投影；如果查询失败，面板会直接显示后端错误。"
					title="官网目标任务读取失败"
				/>
			}
			filters={targetJobFilters}
			pagination={<PanelPagination />}
			perPage={20}
			sort={{ field: "updatedAt", order: "DESC" }}
			sx={PANEL_LIST_SX}
			title="官网目标任务"
		>
			<Stack spacing={2}>
				<OfficialWebTargetJobsContractNotice />
				<PanelResponsiveDatagrid minWidth={1480}>
					<Datagrid
						bulkActionButtons={false}
						empty={<OfficialWebTargetJobsEmpty />}
						header={<PanelDatagridHeader />}
					>
						<TextField label="目标任务 ID" source="id" />
						<TextField label="站点" source="siteId" />
						<TextField label="目标" source="targetId" />
						<FunctionField
							label="状态"
							render={(record: OfficialWebTargetJobRecord) => (
								<OfficialWebTargetJobStatusChip status={record.status} />
							)}
						/>
						<FunctionField
							label="消费族"
							render={(record: OfficialWebTargetJobRecord) => (
								<OfficialWebConsumerFamilyChip consumerFamily={record.consumerFamily} />
							)}
						/>
						<FunctionField
							label="物化"
							render={(record: OfficialWebTargetJobRecord) => (
								<OfficialWebMaterializationPolicyChip
									materializationPolicy={record.materializationPolicy}
								/>
							)}
						/>
						<TextField label="写入目标" source="selectedWriteTarget" />
						<TextField label="候选" source="candidateCount" />
						<TextField label="尝试" source="attemptCount" />
						<FunctionField
							label="产物校验"
							render={(record: OfficialWebTargetJobRecord) => (
								<OfficialWebArtifactVerificationChip record={record} />
							)}
						/>
						<TextField label="最近运行" source="latestRunId" />
						<DateField label="更新时间" locales="zh-CN" showTime source="updatedAt" />
						<FunctionField
							label={PANEL_COPY.view}
							render={(record: OfficialWebTargetJobRecord) => (
								<Button
									component={RouterLink}
									size="small"
									to={buildOfficialWebTargetJobShowPath(record.id)}
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
