import { Alert, Card, CardContent, Stack, Typography } from "@mui/material";
import { Datagrid, DateField, FunctionField, List, ShowButton, TextField } from "react-admin";

import { PANEL_COPY } from "../panel-copy";
import { PanelPagination } from "../panel-pagination";
import type { OfficialWebSiteRecord } from "../types";
import {
  OfficialWebHostsSummary,
  OfficialWebIngestionStatusChip,
  OfficialWebRunStatusChip,
} from "./official-web-presenters";

function OfficialWebSitesAside() {
  return (
    <Card sx={{ width: { lg: 320, xs: "100%" } }}>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">运行时契约</Typography>
          <Alert severity="info">
            站点列表读取 app-api 维护的 official_web 站点投影，不会直接检查对象存储、队列或 ingestion-worker 内部细节。
          </Alert>
        </Stack>
      </CardContent>
    </Card>
  );
}

export function OfficialWebSitesListPage() {
  return (
    <List
      aside={<OfficialWebSitesAside />}
      emptyWhileLoading
      pagination={<PanelPagination />}
      perPage={50}
      title="官网站点"
    >
      <Datagrid bulkActionButtons={false} rowClick="show">
        <TextField label="站点 ID" source="siteId" />
        <TextField label="显示名称" source="displayName" />
        <FunctionField
          label="主机"
          render={(record: OfficialWebSiteRecord) => (
            <OfficialWebHostsSummary hostRoots={record.hostRoots} />
          )}
        />
        <TextField label="最近运行" source="latestRunId" />
        <FunctionField
          label="最近状态"
          render={(record: OfficialWebSiteRecord) =>
            record.latestRunStatus ? <OfficialWebRunStatusChip status={record.latestRunStatus} /> : PANEL_COPY.noRuns
          }
        />
        <FunctionField
          label="分发"
          render={(record: OfficialWebSiteRecord) => (
            <OfficialWebIngestionStatusChip status={record.latestIngestionDispatchStatus} />
          )}
        />
        <DateField label="最近成功" locales="zh-CN" showTime source="lastSuccessAt" />
        <DateField label="最近失败" locales="zh-CN" showTime source="lastFailureAt" />
        <ShowButton label={PANEL_COPY.view} />
      </Datagrid>
    </List>
  );
}
