import { type ReactNode, startTransition, useEffect, useState } from "react";
import {
  Alert,
  Box,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import { Show, useDataProvider, useRecordContext } from "react-admin";

import type { ProtectedPanelDataProvider } from "../data-provider";
import { PANEL_COPY, formatPanelBoolean, formatPanelMicrousd } from "../panel-copy";
import type { RequestProjectionRecord } from "../types";
import {
  formatAclDecisionLabel,
  formatCapabilityLabel,
  buildRequestDiagnosticEntries,
  formatDuration,
  formatPrincipalTypeLabel,
  formatSelectedTargetLabel,
  formatStatusLabel,
  formatSurfaceLabel,
  formatTimestamp,
} from "./request-formatters";
import {
  RequestActorSummary,
  RequestPreviewText,
  RequestScopeSummary,
  RequestSourceDocumentChips,
  RequestStatusChip,
} from "./request-presenters";

function linkValue(href: string | null, label: string) {
  if (!href) {
    return PANEL_COPY.notAvailable;
  }

  return (
    <Link href={href} rel="noreferrer" target="_blank" underline="hover">
      {label}
    </Link>
  );
}

function RequestFieldRow(props: { label: string; value: ReactNode }) {
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

function RequestShowContent() {
  const dataProvider = useDataProvider<ProtectedPanelDataProvider>();
  const record = useRecordContext<RequestProjectionRecord>();
  const [isObservabilityLoading, setIsObservabilityLoading] = useState(false);
  const [observabilityError, setObservabilityError] = useState<string | null>(null);
  const [observabilityRecord, setObservabilityRecord] = useState<
    Awaited<ReturnType<ProtectedPanelDataProvider["getRequestObservability"]>>["data"] | null
  >(null);

  useEffect(() => {
    if (!record?.requestId) {
      return;
    }

    let isActive = true;

    startTransition(() => {
      setIsObservabilityLoading(true);
      setObservabilityError(null);
      setObservabilityRecord(null);
    });

    void dataProvider
      .getRequestObservability({ requestId: record.requestId })
      .then((response) => {
        if (!isActive) {
          return;
        }

        startTransition(() => {
          setObservabilityRecord(response.data);
          setIsObservabilityLoading(false);
        });
      })
      .catch((error) => {
        if (!isActive) {
          return;
        }

        startTransition(() => {
          setObservabilityError(
            error instanceof Error ? error.message : "加载请求观测详情失败。",
          );
          setIsObservabilityLoading(false);
        });
      });

    return () => {
      isActive = false;
    };
  }, [record?.requestId]);

  if (!record) {
    return null;
  }

  const diagnosticEntries = buildRequestDiagnosticEntries(record.diagnostics);
  const observability = observabilityRecord?.observability ?? null;
  const links = observabilityRecord?.links ?? null;
  const auditSummary = observabilityRecord?.auditSummary ?? null;

  return (
    <Box sx={{ p: 3 }}>
      <Stack spacing={3}>
        <Alert severity="info">
          此视图展示 app-api 的请求投影快照。它被有意设计为读模型，而不是实时执行回放端点。
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
                <Typography variant="h6">身份标识</Typography>
                <Divider />
                <RequestFieldRow label="请求 ID" value={record.requestId} />
                <RequestFieldRow label="追踪 ID" value={record.traceId} />
                <RequestFieldRow
                  label="状态"
                  value={
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                      <RequestStatusChip status={record.status} />
                      <Typography color="text.secondary" variant="body2">
                        {formatStatusLabel(record.status)}
                      </Typography>
                    </Stack>
                  }
                />
                <RequestFieldRow
                  label="接入面"
                  value={formatSurfaceLabel(record.surface)}
                />
                <RequestFieldRow
                  label="会话"
                  value={record.conversationId || PANEL_COPY.notAttached}
                />
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6">主体与路由</Typography>
                <Divider />
                <RequestFieldRow
                  label="主体"
                  value={<RequestActorSummary record={record} />}
                />
                <RequestFieldRow label="主体类型" value={formatPrincipalTypeLabel(record.principalType)} />
                <RequestFieldRow
                  label="能力"
                  value={formatCapabilityLabel(record.requestedCapability)}
                />
                <RequestFieldRow
                  label="请求范围"
                  value={<RequestScopeSummary record={record} />}
                />
                <RequestFieldRow
                  label="选定目标"
                  value={formatSelectedTargetLabel(record.selectedTarget)}
                />
              </Stack>
            </CardContent>
          </Card>

          <Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6">内容快照</Typography>
                <Divider />
                <RequestFieldRow
                  label="问题预览"
                  value={
                    <RequestPreviewText
                      emptyText="未记录问题预览。"
                      text={record.questionPreview}
                    />
                  }
                />
                <RequestFieldRow
                  label="回答预览"
                  value={
                    <RequestPreviewText
                      emptyText="未记录回答预览。"
                      text={record.answerPreview}
                    />
                  }
                />
                <RequestFieldRow
                  label="错误代码"
                  value={record.errorCode || PANEL_COPY.none}
                />
                <RequestFieldRow
                  label="来源文档"
                  value={<RequestSourceDocumentChips sourceDocIds={record.sourceDocIds} />}
                />
              </Stack>
            </CardContent>
          </Card>

          {diagnosticEntries.length > 0 ? (
            <Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
              <CardContent>
                <Stack spacing={2}>
                  <Typography variant="h6">诊断信息</Typography>
                  <Divider />
                  {diagnosticEntries.map((entry) => (
                    <RequestFieldRow
                      key={entry.label}
                      label={entry.label}
                      value={entry.value}
                    />
                  ))}
                </Stack>
              </CardContent>
            </Card>
          ) : null}

          <Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6">质量观测</Typography>
                <Divider />

                {isObservabilityLoading ? (
                  <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 160 }}>
                    <CircularProgress size={28} />
                  </Stack>
                ) : null}

                {!isObservabilityLoading && observabilityError ? (
                  <Alert severity="warning">{observabilityError}</Alert>
                ) : null}

                {!isObservabilityLoading && observability ? (
                  <Box
                    sx={{
                      display: "grid",
                      gap: 2,
                      gridTemplateColumns: {
                        lg: "repeat(3, minmax(0, 1fr))",
                        xs: "1fr",
                      },
                    }}
                  >
                    <Stack spacing={2}>
                      <RequestFieldRow
                        label="是否执行检索"
                        value={formatPanelBoolean(observability.retrievalAttempted)}
                      />
                      <RequestFieldRow
                        label="候选数"
                        value={observability.candidateCount ?? PANEL_COPY.unknown}
                      />
                      <RequestFieldRow
                        label="召回来源数"
                        value={observability.retrievedSourceCount ?? PANEL_COPY.unknown}
                      />
                      <RequestFieldRow
                        label="是否空召回"
                        value={formatPanelBoolean(observability.emptyRecall)}
                      />
                      <RequestFieldRow
                        label="是否期望引用"
                        value={formatPanelBoolean(observability.citationExpected)}
                      />
                      <RequestFieldRow
                        label="是否缺失引用"
                        value={formatPanelBoolean(observability.citationMissing)}
                      />
                      <RequestFieldRow
                        label="引用数"
                        value={observability.citationCount ?? PANEL_COPY.unknown}
                      />
                    </Stack>

                    <Stack spacing={2}>
                      <RequestFieldRow
                        label="模型"
                        value={
                          observability.model.provider || observability.model.name
                            ? `${observability.model.provider || PANEL_COPY.unknown} / ${observability.model.name || PANEL_COPY.unknown}`
                            : PANEL_COPY.unknown
                        }
                      />
                      <RequestFieldRow
                        label="输入 Tokens"
                        value={observability.inputTokens ?? PANEL_COPY.unknown}
                      />
                      <RequestFieldRow
                        label="输出 Tokens"
                        value={observability.outputTokens ?? PANEL_COPY.unknown}
                      />
                      <RequestFieldRow
                        label="缓存输入 Tokens"
                        value={observability.cachedInputTokens ?? PANEL_COPY.unknown}
                      />
                      <RequestFieldRow
                        label="预估成本"
                        value={formatPanelMicrousd(observability.estimatedCost.microusd)}
                      />
                      <RequestFieldRow
                        label="投影延迟"
                        value={formatDuration(observability.projectionLagMs)}
                      />
                      <RequestFieldRow
                        label="观测时间"
                        value={formatTimestamp(observability.measuredAt)}
                      />
                    </Stack>

                    <Stack spacing={2}>
                      <RequestFieldRow
                        label="ACL 判定"
                        value={formatAclDecisionLabel(observability.aclDecision)}
                      />
                      <RequestFieldRow
                        label="ACL 异常"
                        value={observability.aclAnomalyCode || PANEL_COPY.none}
                      />
                      <RequestFieldRow
                        label="是否 Fail Closed"
                        value={formatPanelBoolean(observability.failClosed)}
                      />
                      <RequestFieldRow
                        label="拒答类别"
                        value={observability.refusalClass || PANEL_COPY.none}
                      />
                      <RequestFieldRow
                        label="是否可追踪"
                        value={formatPanelBoolean(observability.traceAvailable)}
                      />
                      <RequestFieldRow
                        label="Trace 链接"
                        value={linkValue(links?.traceLink ?? null, "打开 trace")}
                      />
                      <RequestFieldRow
                        label="问题链接"
                        value={linkValue(links?.issueLink ?? null, "打开问题")}
                      />
                      <RequestFieldRow
                        label="问题指纹"
                        value={links?.issueFingerprint || PANEL_COPY.notAvailable}
                      />
                      <RequestFieldRow
                        label="审计事件数"
                        value={auditSummary?.auditEventCount ?? PANEL_COPY.unknown}
                      />
                      <RequestFieldRow
                        label="最近终态代码"
                        value={auditSummary?.latestTerminalCode || PANEL_COPY.unknown}
                      />
                    </Stack>
                  </Box>
                ) : null}
              </Stack>
            </CardContent>
          </Card>

          <Card sx={{ gridColumn: { lg: "1 / -1", xs: "auto" } }}>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6">时间线</Typography>
                <Divider />
                <Box
                  sx={{
                    display: "grid",
                    gap: 2,
                    gridTemplateColumns: {
                      md: "repeat(4, minmax(0, 1fr))",
                      xs: "1fr",
                    },
                  }}
                >
                  <RequestFieldRow
                    label="开始时间"
                    value={formatTimestamp(record.startedAt)}
                  />
                  <RequestFieldRow
                    label="完成时间"
                    value={formatTimestamp(record.completedAt)}
                  />
                  <RequestFieldRow
                    label="投影时间"
                    value={formatTimestamp(record.projectedAt)}
                  />
                  <RequestFieldRow
                    label="耗时"
                    value={formatDuration(record.durationMs)}
                  />
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Box>
      </Stack>
    </Box>
  );
}

export function RequestShowPage() {
  return (
    <Show title="请求详情">
      <RequestShowContent />
    </Show>
  );
}
