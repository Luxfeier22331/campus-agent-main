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
	return <Alert severity="info">查看页面采集目标、尝试次数和校验状态。</Alert>;
}

function OfficialWebTargetJobsEmpty() {
	return (
		<Card>
			<CardContent>
				<Stack spacing={1.5}>
					<Typography variant="h6">{PANEL_COPY.emptyState.officialWebTargetJobs}</Typography>
					<Typography color="text.secondary" variant="body2">
						当前没有可查看的官网目标任务。
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
					description="官网目标任务加载失败。请稍后重试，或查看服务状态。"
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
							label="更新策略"
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
