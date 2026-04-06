import {
  Alert,
  Card,
  CardContent,
  Stack,
  Typography,
} from "@mui/material";
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
import type { RequestProjectionRecord } from "../types";
import { formatCapabilityLabel, formatDuration } from "./request-formatters";
import {
  RequestActorSummary,
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

const requestFilters = [
  <TextInput alwaysOn key="requestId" label="请求 ID" source="requestId" />,
  <SelectInput
    choices={REQUEST_STATUS_CHOICES}
    emptyText="全部状态"
    key="status"
    label="状态"
    source="status"
  />,
  <TextInput key="surface" label="接入面" source="surface" />,
  <TextInput key="conversationId" label="会话" source="conversationId" />,
];

function RequestListAside() {
  return (
    <Card sx={{ width: { lg: 320, xs: "100%" } }}>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">查询语义</Typography>
          <Alert severity="info">
            请求列表读取 app-api 维护的请求投影视图，不会回放回答运行时，也不会直接检查原始日志。
          </Alert>
          <Typography color="text.secondary" variant="body2">
            分页依赖游标链路。请按顺序向后翻页；如果游标链缺失，直接跳页会按 fail-closed 处理。
          </Typography>
          <Typography color="text.secondary" variant="body2">
            新完成的聊天请求可能会延迟片刻出现，因为投影器需要先物化读模型。
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

function RequestListEmpty() {
  return (
    <Card>
      <CardContent>
        <Stack spacing={1.5}>
          <Typography variant="h6">暂无请求</Typography>
          <Typography color="text.secondary" variant="body2">
            此表只展示 app-api 已经物化完成的请求投影。刚被受理的聊天流量可能会短暂缺席，直到投影追上。
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

export function RequestListPage() {
  return (
    <List
      aside={<RequestListAside />}
      emptyWhileLoading
      empty={<RequestListEmpty />}
      filters={requestFilters}
      pagination={<PanelPagination />}
      perPage={20}
      sort={{ field: "startedAt", order: "DESC" }}
      title="请求"
    >
      <Datagrid bulkActionButtons={false} rowClick="show">
        <TextField label="请求" source="requestId" />
        <FunctionField
          label="主体"
          render={(record: RequestProjectionRecord) => <RequestActorSummary record={record} />}
        />
        <FunctionField
          label="接入面"
          render={(record: RequestProjectionRecord) => (
            <RequestSurfaceLabel surface={record.surface} />
          )}
        />
        <FunctionField
          label="状态"
          render={(record: RequestProjectionRecord) => (
            <RequestStatusChip status={record.status} />
          )}
        />
        <FunctionField
          label="能力"
          render={(record: RequestProjectionRecord) =>
            formatCapabilityLabel(record.requestedCapability)
          }
        />
        <FunctionField
          label="范围"
          render={(record: RequestProjectionRecord) => <RequestScopeSummary record={record} />}
        />
        <FunctionField
          label="问题"
          render={(record: RequestProjectionRecord) => (
            <RequestPreviewText
              emptyText="未记录问题预览。"
              text={record.questionPreview}
            />
          )}
        />
        <FunctionField
          label="耗时"
          render={(record: RequestProjectionRecord) => formatDuration(record.durationMs)}
        />
        <DateField label="开始时间" locales="zh-CN" showTime source="startedAt" />
        <ShowButton label={PANEL_COPY.view} />
      </Datagrid>
    </List>
  );
}
