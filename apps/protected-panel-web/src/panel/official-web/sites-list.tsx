import { Alert, Button, Card, CardContent, Stack, Typography } from "@mui/material";
import { Datagrid, DateField, FunctionField, List, TextField } from "react-admin";
import { Link as RouterLink } from "react-router-dom";

import { PANEL_COPY } from "../panel-copy";
import { PanelDatagridHeader } from "../panel-datagrid-header";
import { PanelListErrorState } from "../panel-list-error";
import { PanelListActions } from "../panel-list-actions";
import { PanelPagination } from "../panel-pagination";
import type { OfficialWebSiteRecord } from "../types";
import { buildOfficialWebSiteShowPath } from "./official-web-routes";
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

function OfficialWebSitesEmpty() {
  return (
    <Card>
      <CardContent>
        <Stack spacing={1.5}>
          <Typography variant="h6">{PANEL_COPY.emptyState.officialWebSites}</Typography>
          <Typography color="text.secondary" variant="body2">
            该读模型只展示 app-api 已经投影完成的官网站点。如果站点尚未完成投影或 staging 仍未导入样本，这里会保持为空。
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

export function OfficialWebSitesListPage() {
  return (
    <List
      actions={<PanelListActions />}
      aside={<OfficialWebSitesAside />}
      empty={<OfficialWebSitesEmpty />}
      emptyWhileLoading
      error={
        <PanelListErrorState
          description="官网站点页读取的是 app-api 维护的 official_web 站点投影；如果后端查询失败，这里会直接暴露错误，而不是把失败误判为空结果。"
          title="官网站点读取失败"
        />
      }
      pagination={<PanelPagination />}
      perPage={50}
      title="官网站点"
    >
      <Datagrid
        bulkActionButtons={false}
        empty={<OfficialWebSitesEmpty />}
        header={<PanelDatagridHeader />}
      >
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
        <FunctionField
          label={PANEL_COPY.view}
          render={(record: OfficialWebSiteRecord) => (
            <Button
              component={RouterLink}
              size="small"
              to={buildOfficialWebSiteShowPath(record.siteId)}
            >
              {PANEL_COPY.view}
            </Button>
          )}
        />
      </Datagrid>
    </List>
  );
}
