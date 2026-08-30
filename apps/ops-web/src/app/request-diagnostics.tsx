import { Button, cn } from "@campus-agent/ui";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import type { OpsRequestDetailResponse, OpsSentryIssuesResponse } from "../shared/ops-contract";
import { formatDuration, formatTimestamp } from "./format";
import { fetchOpsSentryIssues } from "./ops-api/observability";
import { ErrorState, KeyValue, StaleDataWarning } from "./ops-display";
import { formatOpsDomainValue } from "./ops-domain-labels";
import { formatDataStateLabel } from "./ops-view-helpers";

export function RequestDiagnostics({ detail }: { detail: OpsRequestDetailResponse }) {
	const [errorsLoaded, setErrorsLoaded] = useState(false);
	return (
		<>
			<FailureSection detail={detail} />
			<ExecutionSection detail={detail} />
			<ErrorRecordsPanel
				detail={detail}
				enabled={errorsLoaded}
				onLoad={() => setErrorsLoaded(true)}
			/>
		</>
	);
}

function FailureSection({ detail }: { detail: OpsRequestDetailResponse }) {
	const failure = detail.execution.failure;
	if (!hasFailure(failure)) {
		return null;
	}
	return (
		<section aria-labelledby="request-failure-title" data-testid="request-failure">
			<h2 className="mb-3 font-semibold text-foreground text-lg" id="request-failure-title">
				失败摘要
			</h2>
			<div className="grid border-danger/30 border-y text-sm sm:grid-cols-2 lg:grid-cols-3">
				<KeyValue
					label="失败代码"
					value={failure.code ? formatOpsDomainValue(failure.code) : "未记录"}
				/>
				<KeyValue label="操作" value={failure.operation ?? "未记录"} />
				<KeyValue label="详情" value={failure.detail ?? "未记录"} />
				<KeyValue label="HTTP 状态" value={failure.httpStatus?.toString() ?? "未记录"} />
				<KeyValue label="工具调用 ID" value={failure.invocationId ?? "未记录"} />
			</div>
		</section>
	);
}

function ExecutionSection({ detail }: { detail: OpsRequestDetailResponse }) {
	const { model, releases, stages } = detail.execution;
	return (
		<section aria-labelledby="request-execution-title" data-testid="request-execution">
			<div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="font-semibold text-foreground text-lg" id="request-execution-title">
					执行摘要
				</h2>
				<span className="text-muted-foreground text-sm">{stages.length} 个阶段</span>
			</div>
			<div className="grid border-border border-y text-sm sm:grid-cols-2 lg:grid-cols-4">
				<KeyValue label="模型 Provider" value={model.provider ?? "未记录"} />
				<KeyValue label="模型" value={model.name ?? "未记录"} />
				<KeyValue label="模型请求数" value={model.requestCount.toString()} />
				<KeyValue label="输入 Token" value={formatToken(model.tokens.input)} />
				<KeyValue label="缓存输入 Token" value={formatToken(model.tokens.cachedInput)} />
				<KeyValue label="输出 Token" value={formatToken(model.tokens.output)} />
				<KeyValue label="Token 合计" value={formatToken(model.tokens.total)} />
				<KeyValue label="Agent Runtime release" value={releases.agentRuntime ?? "未记录"} />
				<KeyValue label="Execution Control release" value={releases.executionControl ?? "未记录"} />
			</div>
			{stages.length === 0 ? (
				<p className="mt-4 border-border border-y bg-secondary p-4 text-muted-foreground text-sm">
					尚未记录执行阶段。
				</p>
			) : (
				<ol className="mt-4 divide-y divide-border border-border border-y">
					{stages.map((stage) => (
						<li
							className="grid gap-2 py-4"
							key={[
								stage.kind,
								stage.status,
								stage.startedAt,
								stage.completedAt,
								stage.failureKind,
							].join(":")}
						>
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div>
									<p className="font-semibold text-foreground">
										{formatOpsDomainValue(stage.kind)}
									</p>
									<p className="mt-1 text-muted-foreground text-sm">
										{formatTimestamp(stage.startedAt)} 至 {formatTimestamp(stage.completedAt)}
										{stage.durationMs === null ? "" : ` · ${formatDuration(stage.durationMs)}`}
									</p>
								</div>
								<span
									className={cn(
										"font-medium text-sm",
										stage.status === "failed" ? "text-danger" : "text-foreground",
									)}
								>
									{formatOpsDomainValue(stage.status)}
								</span>
							</div>
							{stage.failureKind ? (
								<p className="text-danger text-sm">
									失败类型：{formatOpsDomainValue(stage.failureKind)}
								</p>
							) : null}
						</li>
					))}
				</ol>
			)}
		</section>
	);
}

function ErrorRecordsPanel({
	detail,
	enabled,
	onLoad,
}: {
	detail: OpsRequestDetailResponse;
	enabled: boolean;
	onLoad: () => void;
}) {
	const query = useQuery({
		enabled,
		queryFn: ({ signal }) => fetchOpsSentryIssues(detail.request.requestId, { signal }),
		queryKey: ["ops", "request-errors", detail.request.requestId],
		refetchInterval: detail.request.lifecyclePhase === "FINISHED" ? false : 30_000,
		refetchIntervalInBackground: false,
		staleTime: Number.POSITIVE_INFINITY,
	});
	return (
		<RecordSourceSection
			enabled={enabled}
			loadLabel="加载错误记录"
			onLoad={onLoad}
			onRefresh={() => void query.refetch()}
			refreshing={query.isFetching}
			title="错误记录"
		>
			<ExternalQueryState query={query} title="错误记录">
				{query.data ? <ErrorRecordResults data={query.data} stale={query.isRefetchError} /> : null}
			</ExternalQueryState>
		</RecordSourceSection>
	);
}

function ErrorRecordResults({ data, stale }: { data: OpsSentryIssuesResponse; stale: boolean }) {
	const state = stale
		? "数据可能已过期"
		: data.dataState === "FRESH"
			? null
			: formatDataStateLabel(data.dataState);
	return (
		<>
			<div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
				{state ? <span className="font-medium text-warning">{state}</span> : null}
				<span>{data.issues.length} 条记录</span>
				<span>查询于 {formatTimestamp(data.queriedAt)}</span>
			</div>
			{data.issues.length === 0 ? (
				<p className="border-border border-y bg-secondary p-4 text-muted-foreground text-sm">
					当前请求没有关联的错误记录。
				</p>
			) : (
				<ul aria-label="错误摘要" className="divide-y divide-border border-border border-y">
					{data.issues.map((issue) => (
						<li
							className="grid gap-2 py-3"
							key={`${issue.title}:${issue.status}:${issue.firstSeen}:${issue.lastSeen}`}
						>
							<p className="font-medium text-foreground">{issue.title}</p>
							<div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
								<span>{formatOpsDomainValue(issue.status)}</span>
								{issue.level ? <span>{formatOpsDomainValue(issue.level)}</span> : null}
								<span>{issue.eventCount} 个事件</span>
								<span>首次于 {formatTimestamp(issue.firstSeen)}</span>
								<span>最近于 {formatTimestamp(issue.lastSeen)}</span>
							</div>
						</li>
					))}
				</ul>
			)}
		</>
	);
}

function RecordSourceSection({
	children,
	enabled,
	loadLabel,
	onLoad,
	onRefresh,
	refreshing,
	title,
}: {
	children: React.ReactNode;
	enabled: boolean;
	loadLabel: string;
	onLoad: () => void;
	onRefresh: () => void;
	refreshing: boolean;
	title: string;
}) {
	return (
		<section className="grid gap-4">
			<div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
				<h2 className="font-semibold text-foreground text-lg">{title}</h2>
				{enabled ? (
					<Button
						aria-busy={refreshing}
						aria-label={`刷新${title}`}
						disabled={refreshing}
						onClick={onRefresh}
						variant="outline"
					>
						<RefreshCw className="size-4" />
						<span className="hidden sm:inline">{refreshing ? "刷新中" : "刷新"}</span>
					</Button>
				) : (
					<Button onClick={onLoad} variant="outline">
						{loadLabel}
					</Button>
				)}
			</div>
			<div className="grid gap-3">{children}</div>
		</section>
	);
}

function ExternalQueryState<T>({
	children,
	query,
	title,
}: {
	children: React.ReactNode;
	query: UseQueryResult<T, Error>;
	title: string;
}) {
	if (query.fetchStatus === "idle" && !query.data && !query.isError) {
		return null;
	}
	return (
		<>
			{query.fetchStatus === "fetching" && !query.data ? (
				<p className="text-muted-foreground text-sm" role="status">
					正在读取{title}...
				</p>
			) : null}
			{query.isError && !query.data ? (
				<ErrorState
					error={query.error}
					onRetry={() => query.refetch()}
					title={`${title}读取失败`}
				/>
			) : null}
			{query.isRefetchError && query.data ? (
				<StaleDataWarning
					error={query.error}
					lastSuccessfulAt={query.dataUpdatedAt}
					onRetry={() => void query.refetch()}
					title={`${title}刷新失败`}
				/>
			) : null}
			{children}
		</>
	);
}

function hasFailure(failure: OpsRequestDetailResponse["execution"]["failure"]) {
	return Boolean(
		failure.code ||
			failure.operation ||
			failure.detail ||
			failure.httpStatus ||
			failure.invocationId,
	);
}

function formatToken(value: number | null) {
	return value === null ? "未记录" : new Intl.NumberFormat("zh-CN").format(value);
}
