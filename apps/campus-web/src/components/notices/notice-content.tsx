import { Button, Skeleton, StateMessage } from "@campus-agent/ui";
import type { NoticeAttachmentMetadata, NoticeDetailResponse } from "campus-contracts/notices";
import { ExternalLink, File } from "lucide-react";
import { useId, useMemo } from "react";
import { prepareNoticeContentHtml } from "@/features/notices/content-html";
import { buildInternalPortalNoticeUrl } from "@/features/notices/internal-portal-url";
import { formatTimestamp } from "@/lib/date-time";

export function NoticeContent({ notice }: { notice: NoticeDetailResponse }) {
	const contentHeading = useId();
	const attachmentsHeading = useId();
	const preparedContent = useMemo(
		() => prepareNoticeContentHtml(notice.contentHtml, notice.images),
		[notice],
	);
	return (
		<>
			<section aria-labelledby={contentHeading} className="py-8">
				<h2 className="sr-only" id={contentHeading}>
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

			{notice.attachments.length > 0 ? (
				<section aria-labelledby={attachmentsHeading} className="border-t border-border pt-6">
					<h2 className="text-lg font-semibold tracking-normal" id={attachmentsHeading}>
						附件信息
					</h2>
					<ul className="mt-3 divide-y divide-border border-y border-border">
						{notice.attachments.map((attachment) => (
							<AttachmentRow attachment={attachment} key={attachment.ordinal} />
						))}
					</ul>
				</section>
			) : null}
		</>
	);
}

export function NoticeMetadata({ notice }: { notice: NoticeDetailResponse }) {
	return (
		<dl className="grid min-w-0 gap-x-6 gap-y-2 text-sm text-[var(--sys-text-muted)] sm:grid-cols-2">
			<Metadata label="发布时间">
				<time dateTime={notice.releasedAt}>{formatTimestamp(notice.releasedAt)}</time>
			</Metadata>
			<Metadata label="发布部门">{notice.organization?.name ?? "未标注"}</Metadata>
			<Metadata label="门户栏目">{notice.noticeType.name}</Metadata>
		</dl>
	);
}

export function NoticePortalAction({ notice }: { notice: NoticeDetailResponse }) {
	return (
		<Button asChild size="sm" variant="outline">
			<a
				href={buildInternalPortalNoticeUrl({
					noticeId: notice.noticeId,
					noticeType: notice.noticeType.id,
				})}
				rel="noopener noreferrer"
				target="_blank"
			>
				<ExternalLink aria-hidden="true" />
				在信息门户查看
			</a>
		</Button>
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

export function NoticeDetailSkeleton() {
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
