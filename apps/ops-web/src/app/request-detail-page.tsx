import { Button, cn } from "@campus-agent/ui";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, RefreshCw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { OpsRequestDetailResponse } from "../shared/ops-contract";
import { formatTimestamp } from "./format";
import { fetchOpsRequestDetail } from "./ops-api/observability";
import {
	CopyableValue,
	ErrorState,
	PageHeader,
	PageShell,
	StaleDataWarning,
	StatusBadge,
} from "./ops-display";
import { formatLifecyclePhase, formatOpsDomainValue } from "./ops-domain-labels";
import { formatRequestDuration, normalizeRequestListReturnPath } from "./ops-view-helpers";
import { RequestDiagnostics } from "./request-diagnostics";

export function RequestDetailPage({ from, requestId }: { from?: string; requestId: string }) {
	const detail = useQuery({
		queryFn: ({ signal }) => fetchOpsRequestDetail(requestId, { signal }),
		queryKey: ["ops", "requests", requestId],
		refetchInterval: (query) =>
			query.state.data?.request.lifecyclePhase === "FINISHED" ? false : 30_000,
		refetchIntervalInBackground: false,
	});
	const returnPath = normalizeRequestListReturnPath(from);

	if (detail.isPending) {
		return <PageShell title="运行详情">正在读取运行详情...</PageShell>;
	}
	if (detail.isError && !detail.data) {
		return (
			<section>
				<BackToRequests href={returnPath} />
				<PageHeader title="运行详情" />
				<ErrorState
					error={detail.error}
					onRetry={() => detail.refetch()}
					title="运行详情读取失败"
				/>
			</section>
		);
	}
	if (!detail.data) {
		return <PageShell title="运行详情">正在读取运行详情...</PageShell>;
	}

	return (
		<section>
			<BackToRequests href={returnPath} />
			<PageHeader
				actions={
					<Button
						aria-busy={detail.isFetching}
						disabled={detail.isFetching}
						onClick={() => void detail.refetch()}
						variant="outline"
					>
						<RefreshCw className="size-4" />
						{detail.isFetching ? "刷新中" : "刷新"}
					</Button>
				}
				description="查看用户结果、执行过程和可用于定位失败的运行事实。"
				title="运行详情"
			/>
			{detail.isRefetchError ? (
				<StaleDataWarning
					error={detail.error}
					lastSuccessfulAt={detail.dataUpdatedAt}
					onRetry={() => void detail.refetch()}
					title="运行详情刷新失败"
				/>
			) : null}
			<RequestSummary detail={detail.data} />
			<div className="grid gap-10 py-6">
				<QuestionSection detail={detail.data} />
				<ResultSection detail={detail.data} />
				<SourcesSection detail={detail.data} />
				<RequestDiagnostics detail={detail.data} />
			</div>
			{detail.data.request.lifecyclePhase === "FINISHED" ? null : (
				<p className="border-border border-t pt-4 text-muted-foreground text-xs">
					运行快照生成于 {formatTimestamp(detail.data.generatedAt)}
				</p>
			)}
		</section>
	);
}

function BackToRequests({ href }: { href: string }) {
	return (
		<a
			className="mb-3 inline-flex min-h-10 items-center gap-2 font-medium text-muted-foreground text-sm hover:text-foreground hover:underline"
			href={href}
		>
			<ArrowLeft className="size-4" />
			返回运行记录
		</a>
	);
}

function RequestSummary({ detail }: { detail: OpsRequestDetailResponse }) {
	return (
		<div
			className="flex flex-wrap items-center gap-x-4 gap-y-2 border-border border-y py-4 text-sm"
			data-testid="request-context"
		>
			<StatusBadge status={detail.request.status} />
			<CopyableValue compact label="请求 ID" value={detail.request.requestId} />
			{detail.request.lifecyclePhase === "FINISHED" ? null : (
				<span className="text-muted-foreground">
					{formatLifecyclePhase(detail.request.lifecyclePhase)}
				</span>
			)}
			<span className="text-muted-foreground">{formatTimestamp(detail.request.startedAt)}</span>
			<span className="font-medium text-foreground">
				{formatRequestDuration(detail.request, detail.generatedAt)}
			</span>
		</div>
	);
}

function QuestionSection({ detail }: { detail: OpsRequestDetailResponse }) {
	return (
		<section aria-labelledby="request-question-title" data-testid="request-question">
			<h2 className="mb-3 font-semibold text-foreground text-lg" id="request-question-title">
				用户问题
			</h2>
			<p className="whitespace-pre-wrap break-words border-border border-l-2 pl-4 text-base text-foreground leading-7">
				{detail.question.text}
			</p>
		</section>
	);
}

function ResultSection({ detail }: { detail: OpsRequestDetailResponse }) {
	return (
		<section aria-labelledby="request-result-title" data-testid="request-result">
			<h2 className="mb-4 font-semibold text-foreground text-lg" id="request-result-title">
				会话结果
			</h2>
			{detail.result.state === "WRITTEN" ? (
				<div
					className={cn(
						"border-y py-5",
						detail.result.kind === "error"
							? "border-danger/30 bg-danger-subtle px-4 text-danger"
							: "border-border",
					)}
					role={detail.result.kind === "error" ? "alert" : undefined}
				>
					{detail.result.kind === "error" ? (
						<p className="mb-2 font-semibold">错误结果已写入会话</p>
					) : null}
					<SafeMarkdown>{detail.result.text}</SafeMarkdown>
				</div>
			) : detail.result.state === "MISSING" ? (
				<div className="border border-danger/30 bg-danger-subtle p-4 text-danger" role="alert">
					<p className="font-semibold">会话结果缺失</p>
					<p className="mt-1 text-sm">
						产品状态为 {formatOpsDomainValue(detail.request.status)}
						，但没有找到与本次请求匹配的助手消息。
					</p>
				</div>
			) : (
				<div className="border-border border-y bg-secondary p-4 text-muted-foreground text-sm">
					请求仍在处理中，助手消息尚未写入会话。
				</div>
			)}
		</section>
	);
}

function SafeMarkdown({ children }: { children: string }) {
	return (
		<ReactMarkdown
			components={{
				a: ({ className, ...props }) => (
					<a
						{...props}
						className={cn("break-words font-medium text-info underline", className)}
						rel="noreferrer"
						target="_blank"
					/>
				),
				code: ({ className, ...props }) => (
					<code
						{...props}
						className={cn(
							"break-words rounded bg-secondary px-1 py-0.5 font-mono text-sm",
							className,
						)}
					/>
				),
				li: ({ className, ...props }) => <li {...props} className={cn("ml-5 pl-1", className)} />,
				ol: ({ className, ...props }) => (
					<ol {...props} className={cn("my-3 list-decimal space-y-1", className)} />
				),
				p: ({ className, ...props }) => (
					<p {...props} className={cn("my-3 first:mt-0 last:mb-0 leading-7", className)} />
				),
				pre: ({ className, ...props }) => (
					<pre
						{...props}
						className={cn("my-3 max-w-full overflow-x-auto bg-secondary p-3 text-sm", className)}
					/>
				),
				ul: ({ className, ...props }) => (
					<ul {...props} className={cn("my-3 list-disc space-y-1", className)} />
				),
			}}
			remarkPlugins={[remarkGfm]}
		>
			{children}
		</ReactMarkdown>
	);
}

function SourcesSection({ detail }: { detail: OpsRequestDetailResponse }) {
	if (detail.result.state !== "WRITTEN" || detail.result.sources.length === 0) {
		return null;
	}
	return (
		<section aria-labelledby="request-sources-title" data-testid="request-sources">
			<h2 className="mb-4 font-semibold text-foreground text-lg" id="request-sources-title">
				回答来源
			</h2>
			<ul className="divide-y divide-border border-border border-y">
				{detail.result.sources.map((source, sourceIndex) => (
					<li
						className="grid gap-2 py-4"
						key={[
							source.title,
							source.collectionLabel,
							source.sectionTitle,
							source.versionLabel,
							source.primaryAction.href,
							source.primaryAction.label,
							source.snippet,
							sourceIndex,
						].join(":")}
					>
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div className="flex min-w-0 items-start gap-2">
								<span
									aria-label={`引用 ${source.citationIndexes.join("、")}`}
									className="text-muted-foreground shrink-0 text-sm font-medium"
									role="img"
								>
									{source.citationIndexes.map((index) => `[${index}]`).join(" ")}
								</span>
								<div className="min-w-0">
									<p className="font-medium text-foreground">{source.title}</p>
									{source.sectionTitle ? (
										<p className="mt-1 text-muted-foreground text-xs">{source.sectionTitle}</p>
									) : null}
									<p className="mt-1 text-muted-foreground text-xs">
										{[source.collectionLabel, source.versionLabel].filter(Boolean).join(" · ")}
									</p>
								</div>
							</div>
							<SourceAction source={source} />
						</div>
						{source.snippet ? (
							<p className="max-w-3xl text-muted-foreground text-sm leading-6">{source.snippet}</p>
						) : null}
					</li>
				))}
			</ul>
		</section>
	);
}

function SourceAction({
	source,
}: {
	source: Extract<OpsRequestDetailResponse["result"], { state: "WRITTEN" }>["sources"][number];
}) {
	const action = source.primaryAction;
	if (!action.href) {
		return action.disabledReason ? (
			<span className="text-muted-foreground text-xs">{action.disabledReason}</span>
		) : null;
	}
	return (
		<a
			className="inline-flex min-h-10 items-center gap-2 font-medium text-info text-sm hover:underline"
			href={action.href}
		>
			{action.label}
		</a>
	);
}
