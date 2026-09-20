import {
	ActionGroup,
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	Disclosure,
	DisclosureSummary,
	StateMessage,
} from "@campus-agent/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChatAnswerBody, ChatAnswerSources } from "./chat-answer-content";
import { feedbackVoteLabel } from "./chat-feedback-query";
import { formatTimestamp } from "./format";
import { fetchChatFeedbackDetail } from "./ops-api/chat-feedback";
import { OpsApiError } from "./ops-api/core";
import { CopyableValue, ErrorState, InlineError } from "./ops-display";

const reasonLabels = {
	wrong_intent: "理解错了问题",
	not_enough_detail: "信息不够详细",
	outdated_or_missing_source: "来源过时或缺失",
	incorrect_answer: "回答不正确",
	unclear_or_hard_to_use: "表达不清或难以使用",
	other: "其他原因",
};

export function ChatFeedbackDetailDialog({
	feedbackId,
	onClose,
	restoreFocus,
	returnPath,
}: {
	feedbackId: string | null;
	onClose: () => void;
	restoreFocus: () => void;
	returnPath: string;
}) {
	return (
		<Dialog
			open={feedbackId !== null}
			onOpenChange={(open) => {
				if (!open) {
					onClose();
				}
			}}
		>
			<DialogContent
				className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl"
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					restoreFocus();
				}}
			>
				<DialogHeader>
					<DialogTitle>回答反馈详情</DialogTitle>
					<DialogDescription>查看本条反馈对应的问题和回答。</DialogDescription>
				</DialogHeader>
				{feedbackId ? (
					<FeedbackDetail key={feedbackId} feedbackId={feedbackId} returnPath={returnPath} />
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function FeedbackDetail({ feedbackId, returnPath }: { feedbackId: string; returnPath: string }) {
	const detail = useQuery({
		queryKey: ["ops", "chat-feedback", "detail", feedbackId],
		queryFn: ({ signal }) => fetchChatFeedbackDetail(feedbackId, signal),
		staleTime: 0,
	});
	if (detail.error instanceof OpsApiError && detail.error.status === 404) {
		return (
			<StateMessage
				layout="inline"
				role="status"
				description={<> 该反馈已不可用，可能已撤回或所属会话已删除。请刷新列表。 </>}
			/>
		);
	}
	if (!detail.data) {
		return detail.isError ? (
			<ErrorState
				title="反馈详情读取失败"
				error={detail.error}
				onRetry={() => void detail.refetch()}
			/>
		) : (
			<StateMessage layout="inline" role="status" description={<> 正在读取反馈详情… </>} />
		);
	}
	const data = detail.data;
	return (
		<div className="min-w-0 space-y-5">
			{detail.isError ? <InlineError title="反馈详情刷新失败" error={detail.error} /> : null}
			<div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
				<span className="font-medium">{feedbackVoteLabel(data.vote)}</span>
				<span className="text-muted-foreground">
					最近反馈时间：{formatTimestamp(data.updatedAt)}（北京时间）
				</span>
			</div>
			<p className="text-sm">
				原因：
				{data.reasonCodes.length > 0
					? data.reasonCodes.map((reason) => reasonLabels[reason]).join("、")
					: "未提供原因"}
			</p>
			<section className="min-w-0 space-y-2" aria-label="对应问题">
				<h3 className="font-semibold">问题</h3>
				<p className="whitespace-pre-wrap break-words leading-7">
					{data.question?.text ?? "原问题不可用"}
				</p>
			</section>
			<section className="min-w-0 space-y-2 break-words" aria-label="被评价回答">
				<h3 className="font-semibold">回答</h3>
				<ChatAnswerBody text={data.answer.text} kind="answer" />
				<ChatAnswerSources sources={data.answer.sources} />
			</section>
			<ActionGroup>
				<Button asChild variant="outline">
					<Link
						to="/conversations/$conversationId"
						params={{ conversationId: data.conversationId }}
						search={{ messageId: data.messageId, from: returnPath }}
					>
						查看所属会话
					</Link>
				</Button>
				<Button asChild variant="outline">
					<Link
						to="/requests/$requestId"
						params={{ requestId: data.requestId }}
						search={{ from: returnPath }}
					>
						查看对应请求
					</Link>
				</Button>
			</ActionGroup>
			<Disclosure className="border-t pt-4 text-sm">
				<DisclosureSummary>关联标识</DisclosureSummary>
				{[
					["请求 ID", data.requestId],
					["反馈 ID", data.feedbackId],
					["回答消息 ID", data.messageId],
					["问题消息 ID", data.question?.messageId],
					["会话 ID", data.conversationId],
				].map(([label, value]) =>
					value ? (
						<div className="min-w-0" key={label}>
							<span className="text-muted-foreground">{label}：</span>
							<CopyableValue label={label ?? "关联 ID"} value={value} />
						</div>
					) : null,
				)}
			</Disclosure>
		</div>
	);
}
