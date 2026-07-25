import { Button, cn } from "@campus-agent/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	ArrowLeft,
	Bot,
	CheckCircle2,
	CircleAlert,
	ExternalLink,
	Globe2,
	MessageSquareText,
	RefreshCw,
	Search,
	ServerCog,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { OpsRequestDetailResponse } from "../shared/ops-contract";
import { formatTimestamp } from "./format";
import { fetchOpsRequestDetail } from "./ops-api-client";
import { ErrorState, PageHeader, PageShell, StaleDataWarning, StatusBadge } from "./ops-display";
import { formatLifecyclePhase, formatOpsDomainValue } from "./ops-domain-labels";
import {
	formatRequestCompletedAt,
	formatRequestDuration,
	normalizeRequestListReturnPath,
} from "./ops-view-helpers";

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
					<div className="flex flex-wrap gap-2">
						<Button
							aria-busy={detail.isFetching}
							disabled={detail.isFetching}
							onClick={() => void detail.refetch()}
							variant="outline"
						>
							<RefreshCw className="size-4" />
							{detail.isFetching ? "刷新中" : "刷新"}
						</Button>
						<Button asChild variant="outline">
							<Link params={{ requestId }} search={{ from }} to="/requests/$requestId/system">
								<ServerCog className="size-4" />
								系统记录
							</Link>
						</Button>
					</div>
				}
				description="查看本轮用户请求如何形成会话结果。"
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
				<JourneySection detail={detail.data} />
				<ResultSection detail={detail.data} />
				<SourcesSection detail={detail.data} />
				<UsageSection detail={detail.data} />
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
			<div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="font-semibold text-foreground text-lg" id="request-question-title">
					用户问题
				</h2>
				<span className="text-muted-foreground text-sm">
					会话第 {detail.question.turnSequence} 轮
				</span>
			</div>
			<p className="whitespace-pre-wrap break-words border-border border-l-2 pl-4 text-base text-foreground leading-7">
				{detail.question.text}
			</p>
		</section>
	);
}

function JourneySection({ detail }: { detail: OpsRequestDetailResponse }) {
	const nodes: JourneyNodeData[] = [
		{
			detail: "用户从产品界面发起本轮问题",
			icon: Globe2,
			key: `entry:${detail.journey.entry}`,
			label: formatOpsDomainValue(detail.journey.entry),
		},
		{
			detail: "理解问题并组织回答",
			icon: Bot,
			key: "agent:online-qa",
			label: "在线问答 Agent",
		},
		...detail.journey.actions.map((action, actionIndex) => ({
			detail: actionStatusLabel(action.status),
			icon: Search,
			key: `action:${actionIndex}:${action.capability}`,
			label: formatOpsDomainValue(action.capability),
		})),
		...journeyActionStateNodes(detail.journey.actionsDataState),
		journeyResultNode(detail.result),
	];
	return (
		<section aria-labelledby="request-journey-title" data-testid="request-journey">
			<h2 className="mb-4 font-semibold text-foreground text-lg" id="request-journey-title">
				产品处理
			</h2>
			<ol className="grid max-w-3xl gap-0">
				{nodes.map((node, index) => (
					<li
						className="relative grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 pb-4 last:pb-0"
						key={node.key}
					>
						{index < nodes.length - 1 ? (
							<span
								aria-hidden
								className="absolute left-[1.125rem] top-8 h-[calc(100%-1rem)] border-border border-l"
							/>
						) : null}
						<span className="z-10 grid size-9 place-items-center rounded-full border border-border bg-background text-muted-foreground">
							<node.icon className="size-4" />
						</span>
						<div className="min-w-0 pt-1">
							<p className="font-medium text-foreground">{node.label}</p>
							<p className="mt-1 text-muted-foreground text-sm">{node.detail}</p>
						</div>
					</li>
				))}
			</ol>
		</section>
	);
}

interface JourneyNodeData {
	detail: string;
	icon: typeof Bot;
	key: string;
	label: string;
}

function journeyActionStateNodes(
	state: OpsRequestDetailResponse["journey"]["actionsDataState"],
): JourneyNodeData[] {
	if (state === "FRESH" || state === "NO_DATA") {
		return [];
	}
	const content = {
		PARTIAL: {
			detail: "当前只读取到部分业务能力投影",
			label: "业务处理记录不完整",
		},
		STALE: {
			detail: "当前显示上一次成功读取的业务能力投影",
			label: "业务处理记录为旧数据",
		},
		UNAVAILABLE: {
			detail: "未能读取业务能力投影，请求与会话结果仍按产品记录展示",
			label: "业务处理记录不可用",
		},
	} as const;
	return [{ ...content[state], icon: CircleAlert, key: `action-state:${state}` }];
}

function journeyResultNode(result: OpsRequestDetailResponse["result"]): JourneyNodeData {
	if (result.state === "WRITTEN") {
		return {
			detail: "产品回答已经写入本轮会话",
			icon: CheckCircle2,
			key: "result:written",
			label: "回答已写入会话",
		};
	}
	if (result.state === "MISSING") {
		return {
			detail: "产品已进入终态，但没有找到对应的助手消息",
			icon: CircleAlert,
			key: "result:missing",
			label: "会话结果缺失",
		};
	}
	return {
		detail: "本轮请求尚未形成会话结果",
		icon: MessageSquareText,
		key: "result:pending",
		label: "等待会话结果",
	};
}

function actionStatusLabel(
	status: OpsRequestDetailResponse["journey"]["actions"][number]["status"],
) {
	return {
		COMPLETED: "业务查询已完成",
		FAILED: "业务查询失败",
		PENDING: "等待业务查询",
		RUNNING: "正在查询",
	}[status];
}

function ResultSection({ detail }: { detail: OpsRequestDetailResponse }) {
	return (
		<section aria-labelledby="request-result-title" data-testid="request-result">
			<h2 className="mb-4 font-semibold text-foreground text-lg" id="request-result-title">
				会话回答
			</h2>
			{detail.result.state === "WRITTEN" ? (
				<div className="border-border border-y py-5">
					<SafeMarkdown>{detail.result.text}</SafeMarkdown>
				</div>
			) : detail.result.state === "MISSING" ? (
				<div className="border border-danger/30 bg-danger-subtle p-4 text-danger" role="alert">
					<p className="font-semibold">会话结果缺失</p>
					<p className="mt-1 text-sm">
						产品状态保持为{formatOpsDomainValue(detail.request.status)}
						，但没有找到与本次请求和会话匹配的助手消息。
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
							source.publisherLabel,
							source.sectionTitle,
							source.pageLabel,
							source.versionLabel,
							source.primaryAction.href,
							source.primaryAction.label,
							source.snippet,
							sourceIndex,
						].join(":")}
					>
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div className="min-w-0">
								<p className="font-medium text-foreground">{source.title}</p>
								<p className="mt-1 text-muted-foreground text-xs">
									{[source.collectionLabel, source.publisherLabel].filter(Boolean).join(" · ")}
								</p>
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
			rel={action.external ? "noreferrer" : undefined}
			target={action.external ? "_blank" : undefined}
		>
			{action.label}
			{action.external ? <ExternalLink className="size-4" /> : null}
		</a>
	);
}

function UsageSection({ detail }: { detail: OpsRequestDetailResponse }) {
	const usage = detail.usage;
	return (
		<section aria-labelledby="request-usage-title" data-testid="request-usage">
			<div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
				<h2 className="font-semibold text-foreground text-lg" id="request-usage-title">
					Agent 用量与时间
				</h2>
				{usage.state === "COMPLETE" ? null : (
					<span
						className={cn(
							"text-sm",
							usage.state === "PARTIAL" || usage.state === "UNAVAILABLE"
								? "text-warning"
								: "text-muted-foreground",
						)}
					>
						{usageStateLabel(usage.state)}
					</span>
				)}
			</div>
			<div className="grid border-border border-y sm:grid-cols-2 lg:grid-cols-4">
				<TokenMetric label="输入 token" value={usage.inputTokens} />
				<TokenMetric label="缓存输入 token" value={usage.cachedInputTokens} />
				<TokenMetric label="输出 token" value={usage.outputTokens} />
				<TokenMetric emphasis label="总 token" value={usage.totalTokens} />
			</div>
			<div className="mt-3 grid gap-x-8 gap-y-2 text-muted-foreground text-sm sm:grid-cols-3">
				<p>开始：{formatTimestamp(detail.request.startedAt)}</p>
				<p>完成：{formatRequestCompletedAt(detail.request)}</p>
				<p>耗时：{formatRequestDuration(detail.request, detail.generatedAt)}</p>
			</div>
			<p className="mt-3 text-muted-foreground text-xs">
				Token 只统计主 Agent；缓存输入已包含在输入 token 中，不重复计入总量。
			</p>
		</section>
	);
}

function TokenMetric({
	emphasis = false,
	label,
	value,
}: {
	emphasis?: boolean;
	label: string;
	value: number | null;
}) {
	return (
		<div className="grid gap-1 border-border border-b px-3 py-4 last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0">
			<span className="text-muted-foreground text-xs">{label}</span>
			<span
				className={cn(
					"tabular-nums text-foreground",
					emphasis ? "font-semibold text-xl" : "font-medium text-lg",
				)}
			>
				{value === null ? "不可用" : new Intl.NumberFormat("zh-CN").format(value)}
			</span>
		</div>
	);
}

function usageStateLabel(state: OpsRequestDetailResponse["usage"]["state"]) {
	return {
		COMPLETE: "用量已完整记录",
		IN_PROGRESS: "当前为运行快照",
		NOT_STARTED: "Agent 尚未开始",
		PARTIAL: "仅包含已上报用量",
		UNAVAILABLE: "未取得用量数据",
	}[state];
}
