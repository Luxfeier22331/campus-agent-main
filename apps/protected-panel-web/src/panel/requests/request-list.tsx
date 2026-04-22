import { Alert, Box, Card, CardContent, Stack, Typography } from "@mui/material";
import {
	DatagridConfigurable,
	DateField,
	ExportButton,
	FilterForm,
	FunctionField,
	List,
	SelectInput,
	ShowButton,
	TextField,
	TextInput,
	TopToolbar,
} from "react-admin";

import { PANEL_COPY } from "../panel-copy";
import { PanelDatagridHeader } from "../panel-datagrid-header";
import { PanelListErrorState } from "../panel-list-error";
import { PanelPagination } from "../panel-pagination";
import type { RequestProjectionRecord } from "../types";
import { RequestColumnSettingsButton } from "./request-column-settings-button";
import { formatCapabilityLabel, formatDuration } from "./request-formatters";
import {
	RequestActorSummary,
	RequestOutcomeSummary,
	RequestPreviewText,
	RequestScopeSummary,
	RequestStatusChip,
	RequestSurfaceLabel,
} from "./request-presenters";

export const REQUEST_STATUS_CHOICES = [
	{ id: "accepted", name: PANEL_COPY.requestStatus.accepted },
	{ id: "completed", name: PANEL_COPY.requestStatus.completed },
	{ id: "needs_clarification", name: PANEL_COPY.requestStatus.needs_clarification },
	{ id: "approval_required", name: PANEL_COPY.requestStatus.approval_required },
	{ id: "rejected", name: PANEL_COPY.requestStatus.rejected },
	{ id: "no_answer", name: PANEL_COPY.requestStatus.no_answer },
	{ id: "error", name: PANEL_COPY.requestStatus.error },
];

const REQUEST_LIST_PREFERENCE_KEY = "requests.triage-table";

const requestFilters = [
	<TextInput
		alwaysOn
		helperText={false}
		key="q"
		label={PANEL_COPY.requestsList.searchLabel}
		placeholder={PANEL_COPY.requestsList.searchPlaceholder}
		resettable
		source="q"
	/>,
	<SelectInput
		alwaysOn
		choices={REQUEST_STATUS_CHOICES}
		emptyText={PANEL_COPY.requestsList.allStatuses}
		helperText={false}
		key="status"
		label={PANEL_COPY.requestsList.columns.status}
		source="status"
	/>,
	<TextInput
		alwaysOn
		helperText={false}
		key="conversationId"
		label={PANEL_COPY.requestsList.conversationId}
		resettable
		source="conversationId"
	/>,
];

function RequestListGuide() {
	return (
		<Alert severity="info" sx={{ alignItems: "flex-start" }}>
			<Stack spacing={0.5}>
				<Typography fontWeight={600} variant="subtitle2">
					{PANEL_COPY.requestsList.title}
				</Typography>
				<Typography variant="body2">{PANEL_COPY.requestsList.intro}</Typography>
				<Typography variant="body2">{PANEL_COPY.requestsList.paginationHint}</Typography>
				<Typography variant="body2">{PANEL_COPY.requestsList.projectionLagHint}</Typography>
			</Stack>
		</Alert>
	);
}

function RequestListActions() {
	return (
		<TopToolbar
			sx={{
				alignItems: "stretch",
				display: "flex",
				flexDirection: "column",
				gap: 2,
				px: 0,
			}}
		>
			<Stack
				alignItems={{ md: "center", xs: "flex-start" }}
				direction={{ md: "row", xs: "column" }}
				gap={1.5}
				justifyContent="space-between"
				sx={{ width: "100%" }}
			>
				<Stack spacing={0.25}>
					<Typography fontWeight={600} variant="subtitle1">
						{PANEL_COPY.requestsList.title}
					</Typography>
					<Typography color="text.secondary" variant="body2">
						{PANEL_COPY.requestsList.summary}
					</Typography>
				</Stack>
				<Stack direction="row" flexWrap="wrap" gap={1}>
					<RequestColumnSettingsButton preferenceKey={REQUEST_LIST_PREFERENCE_KEY} />
					<ExportButton label={PANEL_COPY.actions.export} />
				</Stack>
			</Stack>
			<Box
				sx={{
					width: "100%",
					"& .RaFilterForm-form": {
						alignItems: "start",
						display: "grid",
						gap: 1,
						gridTemplateColumns: {
							lg: "minmax(320px, 2fr) minmax(180px, 1fr) minmax(220px, 1fr)",
							xs: "1fr",
						},
					},
					"& .MuiFormControl-root": {
						m: 0,
						width: "100%",
					},
				}}
			>
				<FilterForm filters={requestFilters} />
			</Box>
		</TopToolbar>
	);
}

function RequestListEmpty() {
	return (
		<Card>
			<CardContent>
				<Stack spacing={1.5}>
					<Typography variant="h6">{PANEL_COPY.requestsList.noRequestsTitle}</Typography>
					<Typography color="text.secondary" variant="body2">
						{PANEL_COPY.requestsList.noRequestsDescription}
					</Typography>
				</Stack>
			</CardContent>
		</Card>
	);
}

export function RequestListPage() {
	return (
		<List
			actions={<RequestListActions />}
			error={
				<PanelListErrorState
					description="请求页读取的是 app-api 维护的请求投影视图；当后端查询失败时，面板会直接显示错误，而不是伪装成空列表。"
					title="请求列表读取失败"
				/>
			}
			emptyWhileLoading
			empty={<RequestListEmpty />}
			filters={requestFilters}
			pagination={<PanelPagination />}
			perPage={20}
			sort={{ field: "startedAt", order: "DESC" }}
			title={PANEL_COPY.menu.requests}
		>
			<Stack spacing={2}>
				<RequestListGuide />
				<DatagridConfigurable
					bulkActionButtons={false}
					empty={<RequestListEmpty />}
					header={<PanelDatagridHeader />}
					omit={["requestId", "traceId", "conversationId", "surface", "requestedCapability"]}
					preferenceKey={REQUEST_LIST_PREFERENCE_KEY}
					rowClick="show"
				>
					<DateField
						label={PANEL_COPY.requestsList.columns.startedAt}
						locales="zh-CN"
						showTime
						source="startedAt"
					/>
					<FunctionField
						label={PANEL_COPY.requestsList.columns.status}
						render={(record: RequestProjectionRecord) => (
							<RequestStatusChip status={record.status} />
						)}
						source="status"
					/>
					<FunctionField
						label={PANEL_COPY.requestsList.columns.question}
						render={(record: RequestProjectionRecord) => (
							<RequestPreviewText
								emptyText="未记录问题预览。"
								maxLines={2}
								text={record.questionPreview}
							/>
						)}
						source="questionPreview"
					/>
					<FunctionField
						label={PANEL_COPY.requestsList.columns.principal}
						render={(record: RequestProjectionRecord) => <RequestActorSummary record={record} />}
						source="principalId"
					/>
					<FunctionField
						label={PANEL_COPY.requestsList.columns.scope}
						render={(record: RequestProjectionRecord) => <RequestScopeSummary record={record} />}
						source="selectedTarget"
					/>
					<FunctionField
						label={PANEL_COPY.requestsList.columns.outcome}
						render={(record: RequestProjectionRecord) => <RequestOutcomeSummary record={record} />}
						source="answerPreview"
					/>
					<FunctionField
						label={PANEL_COPY.requestsList.columns.duration}
						render={(record: RequestProjectionRecord) => formatDuration(record.durationMs)}
						source="durationMs"
					/>
					<ShowButton label={PANEL_COPY.view} />

					<TextField label={PANEL_COPY.requestsList.columns.requestId} source="requestId" />
					<TextField label={PANEL_COPY.requestsList.columns.traceId} source="traceId" />
					<TextField
						label={PANEL_COPY.requestsList.columns.conversationId}
						source="conversationId"
					/>
					<FunctionField
						label={PANEL_COPY.requestsList.columns.surface}
						render={(record: RequestProjectionRecord) => (
							<RequestSurfaceLabel surface={record.surface} />
						)}
						source="surface"
					/>
					<FunctionField
						label={PANEL_COPY.requestsList.columns.capability}
						render={(record: RequestProjectionRecord) =>
							formatCapabilityLabel(record.requestedCapability)
						}
						source="requestedCapability"
					/>
				</DatagridConfigurable>
			</Stack>
		</List>
	);
}
