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
import { PanelPagination } from "../panel-pagination";
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

function OfficialWebRunsAside() {
  return (
    <Card sx={{ width: { lg: 320, xs: "100%" } }}>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">读模型说明</Typography>
          <Alert severity="info">
            采集运行列表读取 app-api 维护的投影视图。游标分页按设计只能顺序前进，不会绕过运行时接缝。
          </Alert>
        </Stack>
      </CardContent>
    </Card>
  );
}

export function OfficialWebRunsListPage() {
  return (
    <List
      aside={<OfficialWebRunsAside />}
      emptyWhileLoading
      filters={runFilters}
      pagination={<PanelPagination />}
      perPage={20}
      sort={{ field: "startedAt", order: "DESC" }}
      title="官网采集运行"
    >
      <Datagrid bulkActionButtons={false} rowClick="show">
        <TextField label="运行 ID" source="runId" />
        <TextField label="站点" source="siteId" />
        <FunctionField
          label="运行意图"
          render={(record: OfficialWebRunRecord) => <OfficialWebRunIntentChip runIntent={record.runIntent} />}
        />
        <FunctionField
          label="状态"
          render={(record: OfficialWebRunRecord) => <OfficialWebRunStatusChip status={record.status} />}
        />
        <FunctionField
          label="分发"
          render={(record: OfficialWebRunRecord) => (
            <OfficialWebIngestionStatusChip status={record.ingestionDispatchStatus} />
          )}
        />
        <FunctionField
          label="失败数"
          render={(record: OfficialWebRunRecord) => <OfficialWebFailureSummary record={record} />}
        />
        <DateField label="开始时间" locales="zh-CN" showTime source="startedAt" />
        <DateField label="结束时间" locales="zh-CN" showTime source="finishedAt" />
        <ShowButton label={PANEL_COPY.view} />
      </Datagrid>
    </List>
  );
}
