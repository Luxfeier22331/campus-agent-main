import {
	Alert,
	Button,
	Disclosure,
	DisclosureSummary,
	StateMessage,
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@campus-agent/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, RefreshCw } from "lucide-react";
import type { OpsRequestDetailResponse } from "../shared/ops-contract";
import { ChatAnswerBody, ChatAnswerSources } from "./chat-answer-content";
import { formatTimestamp } from "./format";
import { fetchOpsRequestDetail } from "./ops-api/observability";
import {
	CopyableValue,
	ErrorState,
	PageHeader,
	StaleDataWarning,
	StatusBadge,
} from "./ops-display";
import { formatLifecyclePhase, formatOpsDomainValue } from "./ops-domain-labels";
import { formatRequestDuration, normalizeRequestListReturnPath } from "./ops-view-helpers";
import { RequestDiagnostics, RequestExceptions, RequestRetrieval } from "./request-diagnostics";

export function RequestDetailPage({
	from,
	requestId,
	tab = "result",
}: {
	from?: string;
	requestId: string;
	tab?: string;
}) {
	const navigate = useNavigate();
	const detail = useQuery({
		queryFn: ({ signal }) => fetchOpsRequestDetail(requestId, { signal }),
		queryKey: ["ops", "requests", requestId],
		refetchInterval: (query) => requestDetailPollInterval(query.state.data),
		refetchIntervalInBackground: false,
	});
	const href = useRouterState({ select: (state) => state.location.href });
	const returnPath = normalizeRequestListReturnPath(from);

	if (detail.isPending) {
		return (
			<section>
				<BackToRequests href={returnPath} />
				<PageHeader title="执行详情" />
				<StateMessage layout="inline" role="status" description="正在读取执行详情..." />
			</section>
		);
	}
	if (detail.isError && !detail.data) {
		return (
			<section>
				<BackToRequests href={returnPath} />
				<PageHeader title="执行详情" />
				<ErrorState
					error={detail.error}
					onRetry={() => detail.refetch()}
					title="执行详情读取失败"
				/>
			</section>
		);
	}
	if (!detail.data) {
		return (
			<section>
				<BackToRequests href={returnPath} />
				<PageHeader title="执行详情" />
				<StateMessage layout="inline" role="status" description="正在读取执行详情..." />
			</section>
		);
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
						variant="ghost"
					>
						<RefreshCw className="size-4" />
						{detail.isFetching ? "刷新中" : "刷新"}
					</Button>
				}
				description="查看用户结果、执行过程和可用于定位失败的运行事实。"
				title="执行详情"
			/>
			{detail.isRefetchError ? (
				<StaleDataWarning
					error={detail.error}
					lastSuccessfulAt={detail.dataUpdatedAt}
					onRetry={() => void detail.refetch()}
					title="执行详情刷新失败"
				/>
			) : null}
			<RequestSummary detail={detail.data} />
			<Button asChild variant="secondary" className="mt-4">
				<Link
					to="/conversations/$conversationId"
					params={{ conversationId: detail.data.conversation.id }}
					search={{
						messageId:
							detail.data.conversation.assistantMessageId ?? detail.data.conversation.userMessageId,
						from: href,
					}}
				>
					查看所属会话
				</Link>
			</Button>
			{detail.data.request.lifecyclePhase === "FINISHED" &&
			requestDetailPollInterval(detail.data) !== false ? (
				<p className="mt-3 text-sm text-muted-foreground">
					回答已完成，后台记忆或结果投影仍在处理中。
				</p>
			) : null}
			<RequestExceptions detail={detail.data} />
			<Tabs
				value={tab}
				onValueChange={(value) =>
					void navigate({
						to: "/requests/$requestId",
						params: { requestId },
						search: { from, tab: value },
						replace: true,
						resetScroll: false,
					})
				}
			>
				<TabsList aria-label="执行详情分区">
					<TabsTrigger value="result">结果</TabsTrigger>
					<TabsTrigger value="execution">执行过程</TabsTrigger>
					<TabsTrigger value="retrieval">检索与引用</TabsTrigger>
				</TabsList>
				<TabsContent value="result" className="space-y-6">
					<QuestionSection detail={detail.data} />
					<ResultSection detail={detail.data} />
				</TabsContent>
				<TabsContent value="execution" className="space-y-6">
					<RequestDiagnostics detail={detail.data} from={returnPath} />
				</TabsContent>
				<TabsContent value="retrieval" className="space-y-6">
					{detail.data.result.state === "WRITTEN" ? (
						<div data-testid="request-sources">
							<ChatAnswerSources sources={detail.data.result.sources} />
						</div>
					) : null}
					<RequestRetrieval detail={detail.data} from={returnPath} />
				</TabsContent>
			</Tabs>

			{detail.data.request.lifecyclePhase === "FINISHED" ? null : (
				<p className="border-border border-t pt-4 text-muted-foreground text-xs">
					运行快照生成于 {formatTimestamp(detail.data.generatedAt)}
				</p>
			)}
		</section>
	);
}

export function requestDetailPollInterval(
	detail: OpsRequestDetailResponse | undefined,
): number | false {
	if (detail?.request.lifecyclePhase !== "FINISHED") {
		return 2000;
	}
	if (detail.request.status !== "COMPLETED") {
		return false;
	}
	return detail.execution.stages.some(
		(stage) =>
			(stage.kind === "memory" || stage.kind === "finalization") &&
			["pending", "running"].includes(stage.status),
	)
		? 2000
		: false;
}

function BackToRequests({ href }: { href: string }) {
	return (
		<Button asChild variant="ghost" className="mb-3">
			<Link to={href}>
				<ArrowLeft className="size-4" />
				{href.startsWith("/overview")
					? "返回问答概览"
					: href.startsWith("/conversations?") || href === "/conversations"
						? "返回历史会话"
						: href.startsWith("/chat-feedback")
							? "返回回答反馈"
							: href.startsWith("/conversations/")
								? "返回会话"
								: href.startsWith("/requests/")
									? "返回执行详情"
									: "返回运行记录"}
			</Link>
		</Button>
	);
}

function RequestSummary({ detail }: { detail: OpsRequestDetailResponse }) {
	return (
		<div
			className="flex flex-wrap items-center gap-x-4 gap-y-2 border-border border-y py-4 text-sm"
			data-testid="request-context"
		>
			<StatusBadge status={detail.request.status} />
			<Disclosure>
				<DisclosureSummary>关联标识</DisclosureSummary>
				<CopyableValue compact label="请求 ID" value={detail.request.requestId} />
			</Disclosure>
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
				<div className="max-w-3xl border-y border-border py-5">
					<ChatAnswerBody
						text={detail.result.text}
						kind={detail.result.kind}
						sources={detail.result.sources}
					/>
				</div>
			) : detail.result.state === "MISSING" ? (
				<Alert tone="danger" role="alert">
					<p className="font-semibold">会话结果缺失</p>
					<p className="mt-1 text-sm">
						产品状态为 {formatOpsDomainValue(detail.request.status)}
						，但没有找到与本次请求匹配的助手消息。
					</p>
				</Alert>
			) : (
				<StateMessage description="请求仍在处理中，助手消息尚未写入会话。" />
			)}
		</section>
	);
}
