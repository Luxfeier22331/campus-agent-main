import { useEffect, useState, startTransition } from "react";
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import { useAuthenticated, useDataProvider } from "react-admin";

import type { ProtectedPanelDataProvider } from "../data-provider";
import { PANEL_COPY } from "../panel-copy";
import { formatSurfaceLabel } from "../requests/request-formatters";
import type { PanelOverviewRecord } from "../types";

function formatPrincipalClass(value: string) {
  if (value === "human") {
    return "人工";
  }

  return value;
}

function renderDomainStatus(status: string) {
  if (status === "ready") {
    return <Chip color="success" label={PANEL_COPY.domainStatus.ready} size="small" />;
  }
  if (status === "deferred") {
    return <Chip color="warning" label={PANEL_COPY.domainStatus.deferred} size="small" variant="outlined" />;
  }

  return <Chip color="default" label={PANEL_COPY.domainStatus.blocked} size="small" variant="outlined" />;
}

export function OverviewPage() {
  useAuthenticated();
  const dataProvider = useDataProvider<ProtectedPanelDataProvider>();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [record, setRecord] = useState<PanelOverviewRecord | null>(null);

  useEffect(() => {
    let isActive = true;

    startTransition(() => {
      setError(null);
      setIsLoading(true);
    });

    void dataProvider
      .getOverview()
      .then((response) => {
        if (!isActive) {
          return;
        }

        startTransition(() => {
          setRecord(response.data);
          setIsLoading(false);
        });
      })
      .catch((loadError) => {
        if (!isActive) {
          return;
        }

        startTransition(() => {
          setError(loadError instanceof Error ? loadError.message : "加载面板总览失败。");
          setIsLoading(false);
        });
      });

    return () => {
      isActive = false;
    };
  }, []);

  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={3}>
        <Stack spacing={1}>
          <Typography variant="h4">总览</Typography>
          <Typography color="text.secondary" variant="body1">
            展示 Worker 壳层及其 app-api 查询接缝的受保护运维控制面状态。
          </Typography>
        </Stack>

        {isLoading ? (
          <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 240 }}>
            <CircularProgress />
          </Stack>
        ) : null}

        {!isLoading && error ? <Alert severity="error">{error}</Alert> : null}

        {!isLoading && record ? (
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
                  <Typography variant="h6">运行时</Typography>
                  <Divider />
                  <Stack spacing={1}>
                    <Typography variant="body2">
                      <strong>应用</strong>: {record.appName}
                    </Typography>
                    <Typography variant="body2">
                      <strong>接入面</strong>: {formatSurfaceLabel(record.surface)}
                    </Typography>
                    <Typography variant="body2">
                      <strong>运行时</strong>: {record.runtime}
                    </Typography>
                    <Typography variant="body2">
                      <strong>受保护域名</strong>: {record.protectedHostname || PANEL_COPY.notSet}
                    </Typography>
                    <Typography variant="body2">
                      <strong>保护封装</strong>: {record.protectionEnvelope}
                    </Typography>
                    <Typography variant="body2">
                      <strong>App API 基础 URL</strong>: {record.runtimeApiBaseUrl || PANEL_COPY.workerServiceBinding}
                    </Typography>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Stack spacing={2}>
                  <Typography variant="h6">运维身份上下文</Typography>
                  <Divider />
                  {record.operatorContext ? (
                    <Stack spacing={1}>
                      <Typography variant="body2">
                        <strong>运维 ID</strong>: {record.operatorContext.operatorId}
                      </Typography>
                      <Typography variant="body2">
                        <strong>显示名称</strong>: {record.operatorContext.displayName || PANEL_COPY.notProvided}
                      </Typography>
                      <Typography variant="body2">
                        <strong>邮箱</strong>: {record.operatorContext.email || PANEL_COPY.notProvided}
                      </Typography>
                      <Typography variant="body2">
                        <strong>主体类别</strong>: {formatPrincipalClass(record.operatorContext.principalClass)}
                      </Typography>
                      <Typography variant="body2">
                        <strong>分组</strong>:{" "}
                        {record.operatorContext.groups.length > 0
                          ? record.operatorContext.groups.join(", ")
                          : PANEL_COPY.noGroupsProjected}
                      </Typography>
                    </Stack>
                  ) : (
                    <Alert severity="info">
                      需要先通过上游受保护访问，面板才会把运维身份投影到总览页。
                    </Alert>
                  )}
                </Stack>
              </CardContent>
            </Card>

            <Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
              <CardContent>
                <Stack spacing={2}>
                  <Typography variant="h6">域能力 rollout</Typography>
                  <Divider />
                  <Box
                    sx={{
                      display: "grid",
                      gap: 1.5,
                      gridTemplateColumns: {
                        md: "repeat(3, minmax(0, 1fr))",
                        xs: "1fr",
                      },
                    }}
                  >
                    {Object.entries(record.panelDomains).map(([domain, status]) => (
                      <Stack
                        direction="row"
                        justifyContent="space-between"
                        key={domain}
                        spacing={2}
                        sx={{ alignItems: "center" }}
                      >
                        <Typography variant="body2">
                          {PANEL_COPY.overviewDomains[domain as keyof typeof PANEL_COPY.overviewDomains] ?? domain}
                        </Typography>
                        {renderDomainStatus(status)}
                      </Stack>
                    ))}
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          </Box>
        ) : null}
      </Stack>
    </Box>
  );
}
