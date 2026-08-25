import { Button, cn } from "@campus-agent/ui";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { ExternalLink, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { OpsRequestDetailResponse, OpsSentryIssuesResponse } from "../shared/ops-contract";
import { formatDuration, formatTimestamp } from "./format";
import { fetchOpsSentryIssues } from "./ops-api/observability";
import { CopyableKeyValue, ErrorState, KeyValue, StaleDataWarning } from "./ops-display";
import { formatOpsDomainValue } from "./ops-domain-labels";
import { formatDataStateLabel } from "./ops-view-helpers";

export function RequestDiagnostics({ detail }: { detail: OpsRequestDetailResponse }) {
	const [sentryLoaded, setSentryLoaded] = useState(false);
	return (
		<>
			<FailureSection detail={detail} />
			<ExecutionSection detail={detail} />
			<TechnicalSection detail={detail} />
			<RequestExternalSystems detail={detail} />
			<SentryIssuesPanel
				detail={detail}
				enabled={sentryLoaded}
				onLoad={() => setSentryLoaded(true)}
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
				<KeyValue label="失败类型" value={formatOpsDomainValue(failure.kind)} />
				<KeyValue label="Runtime 错误代码" value={failure.runtimeErrorCode ?? "未记录"} />
				<KeyValue
					label="Agent Runtime HTTP 状态"
					value={failure.agentRuntimeHttpStatus?.toString() ?? "未记录"}
				/>
				<KeyValue label="关闭原因" value={failure.failCloseReason ?? "未记录"} />
				<KeyValue label="终止原因" value={failure.terminalReason ?? "未记录"} />
			</div>
		</section>
	);
}

function ExecutionSection({ detail }: { detail: OpsRequestDetailResponse }) {
	return (
		<section aria-labelledby="request-execution-title" data-testid="request-execution">
			<div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="font-semibold text-foreground text-lg" id="request-execution-title">
					执行过程
				</h2>
				<span className="text-muted-foreground text-sm">
					{detail.execution.steps.length} 个步骤
				</span>
			</div>
			{detail.execution.steps.length === 0 ? (
				<p className="border-border border-y bg-secondary p-4 text-muted-foreground text-sm">
					尚未记录执行步骤。
				</p>
			) : (
				<ol className="divide-y divide-border border-border border-y">
					{detail.execution.steps.map((step) => (
						<li className="grid gap-4 py-5" key={step.stepId}>
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div className="min-w-0">
									<p className="font-semibold text-foreground">
										{formatOpsDomainValue(step.kind)}
										<span className="ml-2 font-mono font-normal text-muted-foreground text-xs">
											{step.stepId}
										</span>
									</p>
									<p className="mt-1 text-muted-foreground text-sm">
										{formatTimestamp(step.startedAt)} 至 {formatTimestamp(step.completedAt)}
									</p>
								</div>
								<span
									className={cn(
										"font-medium text-sm",
										step.status === "failed" ? "text-danger" : "text-foreground",
									)}
								>
									{formatOpsDomainValue(step.status)}
								</span>
							</div>
							<div className="grid gap-x-5 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
								<KeyValue label="工具" value={step.tool ?? "无"} />
								<KeyValue label="父步骤" value={step.parentStepId ?? "无"} />
								<KeyValue label="Task Queue" value={step.taskQueue ?? "未记录"} />
								<KeyValue label="Worker" value={step.workerId ?? "未记录"} />
							</div>
							{step.failureKind ? (
								<p className="text-danger text-sm">
									失败类型：{formatOpsDomainValue(step.failureKind)}
								</p>
							) : null}
							<AttemptList attempts={step.attempts} />
						</li>
					))}
				</ol>
			)}
		</section>
	);
}

function AttemptList({
	attempts,
}: {
	attempts: OpsRequestDetailResponse["execution"]["steps"][number]["attempts"];
}) {
	if (attempts.length === 0) {
		return <p className="text-muted-foreground text-xs">该步骤尚未记录执行尝试。</p>;
	}
	return (
		<div className="grid gap-3">
			{attempts.map((attempt) => (
				<div
					className="grid gap-3 border border-border bg-secondary p-3"
					key={`${attempt.activityAttempt}:${attempt.attempt}:${attempt.scheduledAt ?? "unscheduled"}`}
				>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<p className="font-medium text-foreground text-sm">尝试 {attempt.attempt}</p>
						<span
							className={cn(
								"font-medium text-xs",
								attempt.status === "failed" ? "text-danger" : "text-muted-foreground",
							)}
						>
							{formatOpsDomainValue(attempt.status)}
						</span>
					</div>
					<div className="grid gap-x-5 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
						<KeyValue label="Activity" value={attempt.activityType ?? "未记录"} />
						<KeyValue label="Activity 尝试" value={attempt.activityAttempt.toString()} />
						<KeyValue label="排队耗时" value={formatDuration(attempt.scheduleToStartMs)} />
						<KeyValue
							label="执行耗时"
							value={attempt.completedAt ? formatDuration(attempt.durationMs) : "执行中"}
						/>
						<KeyValue label="Task Queue" value={attempt.taskQueue ?? "未记录"} />
						<KeyValue label="Worker" value={attempt.workerId ?? "未记录"} />
						<KeyValue label="模型 Provider" value={attempt.modelProvider ?? "未记录"} />
						<KeyValue label="模型" value={attempt.modelName ?? "未记录"} />
						<KeyValue label="模型请求数" value={attempt.modelRequestCount.toString()} />
						<KeyValue label="Provider 响应 ID" value={attempt.providerResponseId ?? "未记录"} />
						<KeyValue label="输入 Token" value={formatToken(attempt.tokens.input)} />
						<KeyValue label="缓存输入 Token" value={formatToken(attempt.tokens.cachedInput)} />
						<KeyValue label="输出 Token" value={formatToken(attempt.tokens.output)} />
					</div>
					<AttemptFailure failure={attempt.failure} />
				</div>
			))}
		</div>
	);
}

function AttemptFailure({
	failure,
}: {
	failure: OpsRequestDetailResponse["execution"]["steps"][number]["attempts"][number]["failure"];
}) {
	if (!hasFailure(failure)) {
		return null;
	}
	return (
		<p className="break-words text-danger text-xs">
			{[
				failure.kind ? `失败类型 ${formatOpsDomainValue(failure.kind)}` : null,
				failure.runtimeErrorCode ? `Runtime ${failure.runtimeErrorCode}` : null,
				failure.agentRuntimeHttpStatus ? `HTTP ${failure.agentRuntimeHttpStatus}` : null,
				failure.failCloseReason ? `关闭 ${failure.failCloseReason}` : null,
				failure.terminalReason ? `终止 ${failure.terminalReason}` : null,
			]
				.filter(Boolean)
				.join(" · ")}
		</p>
	);
}

function hasFailure(failure: OpsRequestDetailResponse["execution"]["failure"]) {
	return Boolean(
		failure.kind ||
			failure.runtimeErrorCode ||
			failure.agentRuntimeHttpStatus ||
			failure.failCloseReason ||
			failure.terminalReason,
	);
}

function formatToken(value: number | null) {
	return value === null ? "未记录" : new Intl.NumberFormat("zh-CN").format(value);
}

function TechnicalSection({ detail }: { detail: OpsRequestDetailResponse }) {
	const ids = detail.technical.correlationIds;
	const versions = Object.entries(detail.technical.runtimeVersions);
	return (
		<section aria-labelledby="request-technical-title" data-testid="request-technical">
			<h2 className="mb-4 font-semibold text-foreground text-lg" id="request-technical-title">
				技术信息
			</h2>
			<div className="grid gap-8 border-border border-y py-5 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
				<div>
					<h3 className="mb-2 font-medium text-foreground">关联标识</h3>
					<div className="grid gap-x-4 md:grid-cols-2 xl:grid-cols-3">
						<CopyableKeyValue label="requestId" value={ids.requestId} />
						<CopyableKeyValue label="traceId" value={ids.traceId} />
						<CopyableKeyValue label="conversationId" value={ids.conversationId} />
						<CopyableKeyValue label="runId" value={ids.runId} />
						<CopyableKeyValue label="workflowId" value={ids.workflowId} />
					</div>
				</div>
				<div>
					<h3 className="mb-2 font-medium text-foreground">Release 与运行版本</h3>
					<div className="grid text-sm">
						<KeyValue
							label="Agent Runtime release"
							value={detail.execution.releases.agentRuntime ?? "未记录"}
						/>
						<KeyValue
							label="Execution Control release"
							value={detail.execution.releases.executionControl ?? "未记录"}
						/>
						{versions.map(([name, value]) => (
							<KeyValue key={name} label={formatOpsDomainValue(name)} value={String(value)} />
						))}
					</div>
				</div>
			</div>
		</section>
	);
}

function RequestExternalSystems({ detail }: { detail: OpsRequestDetailResponse }) {
	const links = detail.technical.externalLinks.filter((link) => link.href && link.isAvailable);
	return (
		<section aria-labelledby="external-systems-title">
			<h2 className="mb-3 font-semibold text-foreground text-lg" id="external-systems-title">
				外部系统
			</h2>
			{links.length === 0 ? (
				<p className="text-muted-foreground text-sm">没有可用的外部系统入口。</p>
			) : (
				<div className="flex flex-wrap gap-x-5 gap-y-2">
					{links.map((link) => (
						<a
							className="inline-flex min-h-10 items-center gap-2 font-medium text-info text-sm hover:underline"
							href={link.href ?? undefined}
							key={link.source}
							rel="noreferrer"
							target="_blank"
						>
							{link.label}
							<ExternalLink className="size-4" />
						</a>
					))}
				</div>
			)}
		</section>
	);
}

function SentryIssuesPanel({
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
		queryKey: ["ops", "sentry-issues", detail.request.requestId],
		refetchInterval: detail.request.lifecyclePhase === "FINISHED" ? false : 30_000,
		refetchIntervalInBackground: false,
		staleTime: Number.POSITIVE_INFINITY,
	});
	return (
		<RecordSourceSection
			enabled={enabled}
			loadLabel="加载 Sentry 错误记录"
			onLoad={onLoad}
			onRefresh={() => void query.refetch()}
			refreshing={query.isFetching}
			title="错误记录（Sentry）"
		>
			<ExternalQueryState query={query} title="Sentry 记录">
				{query.data ? <SentryIssueResults data={query.data} stale={query.isRefetchError} /> : null}
			</ExternalQueryState>
		</RecordSourceSection>
	);
}

function SentryIssueResults({ data, stale }: { data: OpsSentryIssuesResponse; stale: boolean }) {
	return (
		<>
			<RecordMetadata count={data.issues.length} data={data} stale={stale} />
			{data.issues.length === 0 ? (
				<p className="border-border border-y bg-secondary p-4 text-muted-foreground text-sm">
					当前运行没有关联的 Sentry Issue。
				</p>
			) : (
				<ul
					aria-label="Sentry Issue 摘要"
					className="divide-y divide-border border-border border-y"
				>
					{data.issues.map((issue) => (
						<li className="grid gap-2 py-3" key={issue.issueId}>
							<div className="flex flex-wrap items-start justify-between gap-2">
								<div className="min-w-0">
									<p className="font-medium text-foreground">{issue.title}</p>
									<div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
										<span>{issue.projectName}</span>
										<span>{issue.shortId}</span>
									</div>
								</div>
								<a
									className="inline-flex min-h-9 items-center gap-2 text-info text-sm hover:underline"
									href={issue.permalink}
									rel="noreferrer"
									target="_blank"
								>
									在 Sentry 查看
									<ExternalLink className="size-4" />
								</a>
							</div>
							<div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
								<span>{formatOpsDomainValue(issue.status)}</span>
								<span>{issue.eventCount} 个事件</span>
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

function RecordMetadata({
	count,
	data,
	stale,
}: {
	count: number;
	data: Pick<
		OpsSentryIssuesResponse,
		"dataState" | "from" | "queriedAt" | "queryDurationMs" | "to" | "truncated"
	>;
	stale: boolean;
}) {
	const state = stale
		? "数据可能已过期"
		: data.dataState === "FRESH"
			? null
			: formatDataStateLabel(data.dataState);
	return (
		<div className="grid gap-1.5 text-muted-foreground text-xs">
			<div className="flex flex-wrap gap-x-4 gap-y-1">
				{state ? <span className="font-medium text-warning">{state}</span> : null}
				<span>{count} 条记录</span>
				<span>查询耗时 {formatDuration(data.queryDurationMs)}</span>
				{data.truncated ? <span className="font-medium text-warning">结果已截断</span> : null}
			</div>
			<p>查询于 {formatTimestamp(data.queriedAt)}</p>
			<p>
				时间范围：{formatTimestamp(data.from)} 至 {formatTimestamp(data.to)}
			</p>
		</div>
	);
}
