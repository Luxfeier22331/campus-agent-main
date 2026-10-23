import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
	StateMessage,
} from "@campus-agent/ui";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { noticeDetailQueryOptions } from "@/features/notices/queries";
import { noticeQueryClient } from "@/features/notices/query-client";
import { ApiRequestError } from "@/platform/api/client";
import {
	NoticeContent,
	NoticeDetailSkeleton,
	NoticeMetadata,
	NoticePortalAction,
} from "./notice-content";

export function NoticePreviewDialog({
	noticeId,
	title,
	open,
	onOpenChange,
	restoreFocus,
}: {
	noticeId: string;
	title: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	restoreFocus: () => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className="flex max-h-[90dvh] w-[calc(100%-1rem)] max-w-[840px] flex-col gap-0 overflow-hidden p-0 sm:max-h-[85dvh] sm:w-[calc(100%-2rem)] sm:p-0"
				closeLabel="关闭通知预览"
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					restoreFocus();
				}}
			>
				<NoticePreviewContent noticeId={noticeId} title={title} />
			</DialogContent>
		</Dialog>
	);
}

function NoticePreviewContent({ noticeId, title }: { noticeId: string; title: string }) {
	const notice = useQuery(noticeDetailQueryOptions(noticeId), noticeQueryClient);
	const notFound = notice.error instanceof ApiRequestError && notice.error.status === 404;
	return (
		<>
			<header className="shrink-0 border-b px-5 py-4 pr-14 sm:px-6 sm:pr-14">
				<DialogTitle className="break-words text-xl leading-7">
					{notice.data?.title ?? title}
				</DialogTitle>
				<DialogDescription className="sr-only">通知全文及附件信息</DialogDescription>
				{notice.data ? (
					<div className="mt-3">
						<NoticeMetadata notice={notice.data} />
					</div>
				) : null}
			</header>
			<section
				className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-5 outline-none sm:px-6"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable reading content needs keyboard focus.
				tabIndex={0}
				aria-label="通知阅读区"
			>
				{notice.isPending ? <NoticeDetailSkeleton /> : null}
				{notice.isError ? (
					<StateMessage
						className="mt-5"
						layout="section"
						role="alert"
						title={notFound ? "通知不存在" : "通知暂时不可用"}
						description={
							notFound ? "这条通知不存在，或你没有权限查看。" : "通知暂时无法读取，请稍后重试。"
						}
						tone={notFound ? "neutral" : "danger"}
						primaryAction={
							notFound ? undefined : <Button onClick={() => void notice.refetch()}>重试</Button>
						}
					/>
				) : null}
				{notice.data ? <NoticeContent notice={notice.data} /> : null}
			</section>
			<footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t px-5 py-3 sm:px-6">
				{notice.data ? <NoticePortalAction notice={notice.data} /> : null}
				<Button asChild size="sm" variant="outline">
					<a
						href={`/notices/${encodeURIComponent(noticeId)}`}
						target="_blank"
						rel="noopener noreferrer"
					>
						<ExternalLink aria-hidden="true" />
						打开完整通知页
					</a>
				</Button>
			</footer>
		</>
	);
}
