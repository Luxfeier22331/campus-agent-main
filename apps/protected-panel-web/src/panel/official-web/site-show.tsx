import type { ReactNode } from "react";
import { Alert, Box, Card, CardContent, Divider, Stack, Typography } from "@mui/material";
import { Show, useRecordContext } from "react-admin";

import type { OfficialWebSiteRecord } from "../types";
import { PANEL_COPY } from "../panel-copy";
import { formatTimestamp } from "./official-web-formatters";
import {
  OfficialWebHostsSummary,
  OfficialWebIngestionStatusChip,
  OfficialWebRunStatusChip,
} from "./official-web-presenters";

function SiteFieldRow(props: { label: string; value: ReactNode }) {
  return (
    <Stack spacing={0.5}>
      <Typography color="text.secondary" variant="caption">
        {props.label}
      </Typography>
      <Typography component="div" variant="body2">
        {props.value}
      </Typography>
    </Stack>
  );
}

function OfficialWebSiteShowContent() {
  const record = useRecordContext<OfficialWebSiteRecord>();

  if (!record) {
    return null;
  }

  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={3}>
        <Alert severity="info">
          此视图展示 app-api 维护的 official_web 站点投影，以及最近一次投影到位的采集运行。它不是基础设施控制台。
        </Alert>

        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: {
              lg: "repeat(2, minmax(0, 1fr))",
              xs: "1fr",
            },
          }}
        >
          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6">站点标识</Typography>
                <Divider />
                <SiteFieldRow label="站点 ID" value={record.siteId} />
                <SiteFieldRow label="显示名称" value={record.displayName} />
                <SiteFieldRow label="主机" value={<OfficialWebHostsSummary hostRoots={record.hostRoots} />} />
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6">最近投影</Typography>
                <Divider />
                <SiteFieldRow label="最近运行" value={record.latestRunId || PANEL_COPY.noRuns} />
                <SiteFieldRow
                  label="最近状态"
                  value={
                    record.latestRunStatus ? (
                      <OfficialWebRunStatusChip status={record.latestRunStatus} />
                    ) : (
                      PANEL_COPY.noRuns
                    )
                  }
                />
                <SiteFieldRow
                  label="分发"
                  value={<OfficialWebIngestionStatusChip status={record.latestIngestionDispatchStatus} />}
                />
                <SiteFieldRow label="最近成功" value={formatTimestamp(record.lastSuccessAt)} />
                <SiteFieldRow label="最近失败" value={formatTimestamp(record.lastFailureAt)} />
              </Stack>
            </CardContent>
          </Card>

          <Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6">最近运行</Typography>
                <Divider />
                {record.recentRuns && record.recentRuns.length > 0 ? (
                  <Stack spacing={1.5}>
                    {record.recentRuns.map((run) => (
                      <Stack key={run.runId} spacing={0.5}>
                        <Typography variant="body2">
                          <strong>{run.runId}</strong>
                        </Typography>
                        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                          <OfficialWebRunStatusChip status={run.status} />
                          <OfficialWebIngestionStatusChip status={run.ingestionDispatchStatus} />
                          <Typography color="text.secondary" variant="caption">
                            开始于 {formatTimestamp(run.startedAt)}
                          </Typography>
                        </Stack>
                      </Stack>
                    ))}
                  </Stack>
                ) : (
                  <Typography color="text.secondary" variant="body2">
                    {PANEL_COPY.noRecentRuns}
                  </Typography>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Box>
      </Stack>
    </Box>
  );
}

export function OfficialWebSiteShowPage() {
  return (
    <Show title="官网站点详情">
      <OfficialWebSiteShowContent />
    </Show>
  );
}
