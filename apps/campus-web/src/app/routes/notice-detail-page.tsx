import { Button, Skeleton } from "@campus-agent/ui";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import type { NoticeAttachmentMetadata } from "campus-contracts/notices";
import { ArrowLeft, ExternalLink, File } from "lucide-react";
import { useMemo } from "react";
import { StateMessage } from "@/components/ui/state-message";
import { NoticeCategoryBadge } from "@/features/notices/category-badge";
import { prepareNoticeContentHtml } from "@/features/notices/content-html";
import { buildInternalPortalNoticeUrl } from "@/features/notices/internal-portal-url";
import { noticeDetailQueryOptions } from "@/features/notices/queries";
import { noticeQueryClient } from "@/features/notices/query-client";
import { parseTransportSearch, transportReturnTarget } from "@/features/transport/route-search";
import { ApiRequestError } from "@/platform/api/client";

const RELEASE_DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
	dateStyle: "long",
	timeStyle: "short",
	timeZone: "Asia/Shanghai",
});

export function NoticeDetailPage() {
	return (
		<QueryClientProvider client={noticeQueryClient}>
			<NoticeDetailPageContent />
		</QueryClientProvider>
	);
}

export function NoticeDetailPageContent() {
	const { noticeId } = useParams({ from: "/notices/$noticeId" });
	const search = useSearch({ from: "/notices/$noticeId" });
	const returnTo = transportReturnTarget(search.returnTo);
	const notice = useQuery(noticeDetailQueryOptions(noticeId));
	const preparedContent = useMemo(
		() =>
			notice.data
				? prepareNoticeContentHtml(notice.data.contentHtml, notice.data.images)
				: { status: "empty" as const },
		[notice.data],
	);
	const noticeNotFound = notice.error instanceof ApiRequestError && notice.error.status === 404;
	const isCampusNews = notice.data?.category === "campus_news";

	return (
		<article className="mx-auto w-full max-w-[var(--layout-docs-content-width)] px-4 py-6 pb-24 sm:px-5 lg:px-6">
			<Button asChild className="-ml-3" size="sm" variant="ghost">
				{returnTo ? (
					<Link
						to="/transport"
						search={parseTransportSearch(
							Object.fromEntries(new URL(returnTo, "https://campus.local").searchParams),
						)}
					>
						<ArrowLeft />
						返回班车
					</Link>
				) : (
					<Link
						search={{
							page: 1,
							stream: isCampusNews ? "campus_news" : "notices",
						}}
						to="/notices"
					>
						<ArrowLeft />
						{isCampusNews ? "返回校园动态" : "返回通知目录"}
					</Link>
				)}
			</Button>

			{notice.isPending ? <NoticeDetailSkeleton /> : null}
			{notice.isError ? (
				<StateMessage
					className="mt-5"
					description={
						noticeNotFound ? "这条通知不存在，或你没有权限查看。" : "通知暂时无法读取，请稍后重试。"
					}
					layout="section"
					primaryAction={
						noticeNotFound ? (
							<Button asChild>
								<Link search={{ page: 1, stream: "notices" }} to="/notices">
									返回通知目录
								</Link>
							</Button>
						) : (
							<Button onClick={() => void notice.refetch()}>重试</Button>
						)
					}
					role="alert"
					title={noticeNotFound ? "通知不存在" : "通知暂时不可用"}
					tone={noticeNotFound ? "neutral" : "danger"}
				/>
			) : null}
			{notice.data ? (
				<>
					<header className="border-b border-border pb-6 pt-4">
						<NoticeCategoryBadge category={notice.data.category} />
						<h1 className="mt-4 break-words text-2xl font-semibold leading-9 tracking-normal text-[var(--sys-text-strong)] md:text-3xl md:leading-10">
							{notice.data.title}
						</h1>
						<div className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-3 sm:gap-x-6">
							<dl className="grid min-w-0 gap-x-6 gap-y-2 text-sm text-[var(--sys-text-muted)] sm:grid-cols-2">
								<Metadata label="发布时间">
									<time dateTime={notice.data.releasedAt}>
										{RELEASE_DATE_FORMATTER.format(new Date(notice.data.releasedAt))}
									</time>
								</Metadata>
								<Metadata label="发布部门">{notice.data.organization?.name ?? "未标注"}</Metadata>
								<Metadata label="门户栏目">{notice.data.noticeType.name}</Metadata>
							</dl>
							<Button asChild size="sm" variant="outline">
								<a
									href={buildInternalPortalNoticeUrl({
										noticeId: notice.data.noticeId,
										noticeType: notice.data.noticeType.id,
									})}
									rel="noopener noreferrer"
									target="_blank"
								>
									<ExternalLink aria-hidden="true" />
									在信息门户查看
								</a>
							</Button>
						</div>
					</header>

					<section aria-labelledby="notice-content-heading" className="py-8">
						<h2 className="sr-only" id="notice-content-heading">
							通知正文
						</h2>
						{preparedContent.status === "ready" ? (
							<div
								className="notice-content"
								// biome-ignore lint/security/noDangerouslySetInnerHtml: DOMParser validated the complete tag and attribute allowlist above.
								dangerouslySetInnerHTML={{ __html: preparedContent.html }}
							/>
						) : preparedContent.status === "empty" ? (
							<StateMessage
								description="这条通知没有可展示的站内正文。"
								layout="section"
								title="正文为空"
							/>
						) : (
							<StateMessage
								description="正文暂时无法安全展示，附件和门户入口仍可使用。"
								layout="section"
								role="alert"
								title="正文暂时无法展示"
								tone="danger"
							/>
						)}
					</section>

					{notice.data.attachments.length > 0 ? (
						<section
							aria-labelledby="notice-attachments-heading"
							className="border-t border-border pt-6"
						>
							<h2 className="text-lg font-semibold tracking-normal" id="notice-attachments-heading">
								附件信息
							</h2>
							<ul className="mt-3 divide-y divide-border border-y border-border">
								{notice.data.attachments.map((attachment) => (
									<AttachmentRow attachment={attachment} key={attachment.ordinal} />
								))}
							</ul>
						</section>
					) : null}
				</>
			) : null}
		</article>
	);
}

function Metadata({ children, label }: { children: React.ReactNode; label: string }) {
	return (
		<div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
			<dt className="text-[var(--sys-text-subtle)]">{label}</dt>
			<dd className="min-w-0 break-words text-[var(--sys-text-default)]">{children}</dd>
		</div>
	);
}

function AttachmentRow({ attachment }: { attachment: NoticeAttachmentMetadata }) {
	return (
		<li className="flex min-h-16 items-center gap-3 py-3">
			<File aria-hidden="true" className="size-5 shrink-0 text-[var(--sys-text-subtle)]" />
			<div className="min-w-0 flex-1">
				<p className="break-words text-sm font-medium text-[var(--sys-text-strong)]">
					<a
						className="inline-flex max-w-full items-center gap-1 text-[var(--sys-text-strong)] underline decoration-border underline-offset-4 hover:text-[var(--sys-text-default)]"
						href={attachment.downloadUrl}
						rel="noopener noreferrer"
						target="_blank"
					>
						<span className="min-w-0 break-words">
							{attachment.name ?? `附件 ${attachment.ordinal + 1}`}
						</span>
						<ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
					</a>
				</p>
				<p className="mt-1 text-xs text-[var(--sys-text-muted)]">
					{formatContentType(attachment.contentType)} · {formatByteSize(attachment.byteSize)}
				</p>
			</div>
		</li>
	);
}

function NoticeDetailSkeleton() {
	return (
		<div aria-label="正在读取通知正文" className="pt-5" role="status">
			<Skeleton className="h-5 w-20" />
			<Skeleton className="mt-4 h-8 w-full" />
			<Skeleton className="mt-2 h-8 w-3/4" />
			<div className="mt-6 grid gap-3 sm:grid-cols-2">
				<Skeleton className="h-4 w-48" />
				<Skeleton className="h-4 w-40" />
			</div>
			<div className="mt-10 space-y-3">
				<Skeleton className="h-4 w-full" />
				<Skeleton className="h-4 w-full" />
				<Skeleton className="h-4 w-5/6" />
			</div>
		</div>
	);
}

function formatByteSize(value: string): string {
	const bytes = Number(value);
	if (!Number.isSafeInteger(bytes) || bytes < 0) {
		return value;
	}
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function formatContentType(value: string): string {
	const labels: Record<string, string> = {
		"application/msword": "Word 文档",
		"application/pdf": "PDF",
		"application/vnd.ms-excel": "Excel 表格",
		"application/vnd.ms-powerpoint": "PowerPoint",
		"application/vnd.openxmlformats-officedocument.presentationml.presentation": "PowerPoint",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel 表格",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word 文档",
		"application/zip": "ZIP 压缩包",
	};
	return labels[value] ?? value;
}
