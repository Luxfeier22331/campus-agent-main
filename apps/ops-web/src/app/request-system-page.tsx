import { Button } from "@campus-agent/ui";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import type {
	OpsObservabilityResponse,
	OpsRequestDetailResponse,
	OpsSentryIssuesResponse,
} from "../shared/ops-contract";
import { formatDuration, formatTimestamp } from "./format";
import {
	fetchOpsObservability,
	fetchOpsRequestDetail,
	fetchOpsSentryIssues,
} from "./ops-api/observability";
import {
	CopyableKeyValue,
	ErrorState,
	KeyValue,
	PageHeader,
	PageShell,
	StaleDataWarning,
} from "./ops-display";
import { formatOpsDomainValue } from "./ops-domain-labels";
import { formatDataStateLabel } from "./ops-view-helpers";

type SystemSource = "logs" | "sentry";

export function RequestSystemPage({
	from,
	requestId,
}: {
	from?: string | undefined;
	requestId: string;
}) {
	const [sourceSelection, setSourceSelection] = useState({
		loaded: { logs: false, sentry: false },
		requestId,
	});
	const detail = useQuery({
		queryFn: ({ signal }) => fetchOpsRequestDetail(requestId, { signal }),
		queryKey: ["ops", "requests", requestId],
		refetchInterval: (query) =>
			query.state.data?.request.lifecyclePhase === "FINISHED" ? false : 30_000,
		refetchIntervalInBackground: false,
	});
	if (detail.isPending) {
		return <PageShell title="系统记录">正在读取系统记录...</PageShell>;
	}
	if (detail.isError && !detail.data) {
		return (
			<section>
				<BackToDetail from={from} requestId={requestId} />
				<PageHeader title="系统记录" />
				<ErrorState
					error={detail.error}
					onRetry={() => detail.refetch()}
					title="系统记录读取失败"
				/>
			</section>
		);
	}
	if (!detail.data) {
		return <PageShell title="系统记录">正在读取系统记录...</PageShell>;
	}

	const loaded =
		sourceSelection.requestId === requestId
			? sourceSelection.loaded
			: { logs: false, sentry: false };
	const load = (source: SystemSource) => {
		setSourceSelection((current) => ({
			loaded: {
				...(current.requestId === requestId ? current.loaded : { logs: false, sentry: false }),
				[source]: true,
			},
			requestId,
		}));
	};

	return (
		<section>
			<BackToDetail from={from} requestId={requestId} />
			<PageHeader
				actions={
					<Button
						aria-busy={detail.isFetching}
						className="self-start lg:self-auto"
						disabled={detail.isFetching}
						onClick={() => void detail.refetch()}
						variant="outline"
					>
						<RefreshCw className="size-4" />
						{detail.isFetching ? "刷新中" : "刷新"}
					</Button>
				}
				description="查看关联标识、技术错误、运行版本和按需加载的外部记录。"
				title="系统记录"
			/>
			{detail.isRefetchError ? (
				<StaleDataWarning
					error={detail.error}
					lastSuccessfulAt={detail.dataUpdatedAt}
					onRetry={() => void detail.refetch()}
					title="系统记录刷新失败"
				/>
			) : null}
			<TechnicalSummary detail={detail.data} />
			<RequestExternalSystems detail={detail.data} />
			<div className="mt-8 divide-y divide-border border-border border-y">
				<SentryIssuesPanel
					detail={detail.data}
					enabled={loaded.sentry}
					onLoad={() => load("sentry")}
				/>
				<ObservabilityPanel
					detail={detail.data}
					enabled={loaded.logs}
					kind="logs"
					onLoad={() => load("logs")}
					title="应用日志（Axiom）"
				/>
			</div>
		</section>
	);
}

function BackToDetail({ from, requestId }: { from?: string | undefined; requestId: string }) {
	return (
		<Link
			className="mb-3 inline-flex min-h-10 items-center gap-2 font-medium text-muted-foreground text-sm hover:text-foreground hover:underline"
			params={{ requestId }}
			search={{ from }}
			to="/requests/$requestId"
		>
			<ArrowLeft className="size-4" />
			返回运行详情
		</Link>
	);
}

function TechnicalSummary({ detail }: { detail: OpsRequestDetailResponse }) {
	const ids = detail.technical.correlationIds;
	const versions = Object.entries(detail.technical.runtimeVersions);
	return (
		<div className="grid gap-8 border-border border-y py-5 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
			<section aria-labelledby="correlation-title">
				<h2 className="mb-3 font-semibold text-foreground text-lg" id="correlation-title">
					关联标识
				</h2>
				<div className="grid gap-x-4 md:grid-cols-2 xl:grid-cols-3">
					<CopyableKeyValue label="requestId" value={ids.requestId} />
					<CopyableKeyValue label="traceId" value={ids.traceId} />
					<CopyableKeyValue label="conversationId" value={ids.conversationId} />
					<CopyableKeyValue label="runId" value={ids.runId} />
					<CopyableKeyValue label="workflowId" value={ids.workflowId} />
				</div>
			</section>
			<section aria-labelledby="runtime-title">
				<h2 className="mb-3 font-semibold text-foreground text-lg" id="runtime-title">
					运行信息
				</h2>
				<div className="grid text-sm">
					<KeyValue label="错误代码" value={detail.technical.errorCode ?? "无"} />
					<KeyValue label="终止原因" value={detail.technical.terminalReason ?? "无"} />
					{versions.length === 0 ? (
						<KeyValue label="运行版本" value="未记录" />
					) : (
						versions.map(([name, value]) => (
							<KeyValue key={name} label={formatOpsDomainValue(name)} value={String(value)} />
						))
					)}
				</div>
			</section>
		</div>
	);
}

function RequestExternalSystems({ detail }: { detail: OpsRequestDetailResponse }) {
	const links = detail.technical.externalLinks.filter((link) => link.href && link.isAvailable);
	return (
		<section aria-labelledby="external-systems-title" className="mt-8">
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

function ObservabilityPanel({
	detail,
	enabled,
	kind,
	onLoad,
	title,
}: {
	detail: OpsRequestDetailResponse;
	enabled: boolean;
	kind: "logs";
	onLoad: () => void;
	title: string;
}) {
	const query = useQuery({
		enabled,
		queryFn: ({ signal }) => fetchOpsObservability(detail.request.requestId, kind, { signal }),
		queryKey: ["ops", "observability", detail.request.requestId, kind],
		refetchInterval: detail.request.lifecyclePhase === "FINISHED" ? false : 30_000,
		refetchIntervalInBackground: false,
		staleTime: Number.POSITIVE_INFINITY,
	});
	return (
		<RecordSourceSection
			enabled={enabled}
			loadLabel={`加载${title}`}
			onLoad={onLoad}
			onRefresh={() => void query.refetch()}
			refreshing={query.isFetching}
			title={title}
		>
			<ExternalQueryState query={query} title={title}>
				{query.data ? (
					<>
						<RecordMetadata
							count={query.data.records.length}
							data={query.data}
							stale={query.isRefetchError}
						/>
						<VirtualRecordList response={query.data} />
					</>
				) : null}
			</ExternalQueryState>
		</RecordSourceSection>
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
		<section className="grid gap-4 py-6">
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
		OpsObservabilityResponse | OpsSentryIssuesResponse,
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

function VirtualRecordList({ response }: { response: OpsObservabilityResponse }) {
	const parentRef = useRef<HTMLDivElement>(null);
	const viewportHeight = Math.min(420, Math.max(160, response.records.length * 144));
	const virtualizer = useVirtualizer({
		count: response.records.length,
		estimateSize: () => 144,
		getScrollElement: () => parentRef.current,
		initialRect: { height: viewportHeight, width: 720 },
		overscan: 6,
	});
	const virtualItems = virtualizer.getVirtualItems();
	if (response.records.length === 0) {
		return (
			<p className="border-border border-y bg-secondary p-4 text-muted-foreground text-sm">
				当前运行没有匹配的应用日志。
			</p>
		);
	}
	return (
		<div
			className="overflow-auto border border-foreground bg-foreground text-background"
			data-testid={`observability-record-viewport-${response.kind}`}
			ref={parentRef}
			style={{ height: `${viewportHeight}px` }}
		>
			<ul
				aria-label="应用日志"
				className="relative w-full"
				style={{ height: `${virtualizer.getTotalSize()}px` }}
			>
				{virtualItems.length === 0 ? (
					<li className="absolute left-0 top-0 w-full px-3 py-2">
						<RecordRow index={0} response={response} />
					</li>
				) : (
					virtualItems.map((item) => (
						<li
							className="absolute left-0 top-0 w-full px-3 py-2"
							data-index={item.index}
							key={item.key}
							ref={virtualizer.measureElement}
							style={{ transform: `translateY(${item.start}px)` }}
						>
							<RecordRow index={item.index} response={response} />
						</li>
					))
				)}
			</ul>
		</div>
	);
}

function RecordRow({ index, response }: { index: number; response: OpsObservabilityResponse }) {
	const record = response.records[index];
	return record ? <LogRecordRow record={record} /> : null;
}

type LogRecord = Extract<OpsObservabilityResponse, { kind: "logs" }>["records"][number];

function LogRecordRow({ record }: { record: LogRecord }) {
	return (
		<div className="grid gap-2 border-background/20 border-b p-3 text-background/70 text-xs">
			<div className="flex flex-wrap items-center gap-2">
				<span className="font-medium text-background">{record.severityText ?? "UNKNOWN"}</span>
				<span>{formatTimestamp(record.timestamp)}</span>
				<span>{record.serviceName ?? "未知服务"}</span>
			</div>
			<p className="font-medium text-background">
				{record.eventType ?? record.source ?? "未命名日志事件"}
			</p>
			<div className="flex flex-wrap gap-x-4 gap-y-1">
				<span>状态：{record.status ?? "未记录"}</span>
				<span>
					耗时：{record.durationMs === null ? "未记录" : formatDuration(record.durationMs)}
				</span>
				<span>错误：{record.errorCode ?? "无"}</span>
			</div>
		</div>
	);
}
