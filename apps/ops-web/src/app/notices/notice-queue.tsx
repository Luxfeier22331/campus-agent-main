import { Button, cn, Skeleton } from "@campus-agent/ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { NoticeSummary } from "../../shared/ops-contract";
import { formatTimestamp } from "../format";
import { NoticeCategoryBadge, NoticeStateBadge } from "./notice-status";

export interface NoticeQueueData {
	counts: {
		all: number;
		needsClassification: number;
		needsPublication: number;
		published: number;
	};
	items: NoticeSummary[];
	page: number;
	totalItems: number;
	totalPages: number;
}

export function NoticeQueue({
	data,
	isFetching,
	isPending,
	isPlaceholderData,
	onPage,
	onSelect,
	selectedNoticeId,
}: {
	data: NoticeQueueData | undefined;
	isFetching: boolean;
	isPending: boolean;
	isPlaceholderData: boolean;
	onPage: (page: number) => void;
	onSelect: (noticeId: number) => void;
	selectedNoticeId: number | null;
}) {
	if (isPending && !data) {
		return <NoticeQueueSkeleton />;
	}
	if (!data) {
		return null;
	}
	if (data.items.length === 0) {
		return (
			<section aria-labelledby="notice-queue-title">
				<QueueHeading totalItems={data.totalItems} />
				<div className="grid min-h-56 place-items-center rounded-[var(--card-radius)] border border-dashed border-border px-6 py-12 text-center">
					<div className="grid gap-2">
						<p className="font-medium">没有符合当前筛选条件的通知。</p>
						<p className="text-muted-foreground text-sm">可以调整状态、分类或搜索词后再试。</p>
					</div>
				</div>
			</section>
		);
	}
	return (
		<section aria-labelledby="notice-queue-title" className="min-w-0">
			<QueueHeading totalItems={data.totalItems} />
			<div
				className={cn(
					"transition-opacity duration-[var(--motion-duration-fast)]",
					isFetching && "opacity-70",
				)}
			>
				<ul
					aria-label="通知队列"
					className="divide-y divide-border overflow-hidden rounded-[var(--card-radius)] border border-border bg-card"
				>
					{data.items.map((notice) => {
						const selected = selectedNoticeId === notice.noticeId;
						return (
							<li key={notice.noticeId}>
								<button
									aria-current={selected ? "true" : undefined}
									className={cn(
										"group grid min-h-28 w-full gap-3 px-4 py-4 text-left transition-[background-color,box-shadow] duration-[var(--motion-duration-fast)] hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
										selected &&
											"bg-selected/60 shadow-[inset_3px_0_0_var(--sys-border-selected)] hover:bg-selected",
									)}
									onClick={() => onSelect(notice.noticeId)}
									type="button"
								>
									<div className="flex min-w-0 items-start justify-between gap-3">
										<div className="min-w-0">
											<p className="truncate font-medium text-sm">{notice.title}</p>
											<p className="mt-1 font-mono text-muted-foreground text-xs">
												#{notice.noticeId}
											</p>
										</div>
										<NoticeStateBadge state={notice.state} />
									</div>
									<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
										<span className="truncate">{notice.organization?.name ?? "无组织"}</span>
										<span aria-hidden="true">·</span>
										<span>{notice.noticeType.name}</span>
										<span aria-hidden="true">·</span>
										<time dateTime={notice.releasedAt}>{formatTimestamp(notice.releasedAt)}</time>
									</div>
									<div className="flex items-center justify-between gap-3">
										<NoticeCategoryBadge category={notice.category} />
									</div>
								</button>
							</li>
						);
					})}
				</ul>
			</div>
			<QueuePagination data={data} disabled={isPlaceholderData} onPage={onPage} />
		</section>
	);
}

function QueueHeading({ totalItems }: { totalItems: number }) {
	return (
		<div className="mb-3 flex items-baseline justify-between gap-3">
			<h2 className="font-semibold text-base" id="notice-queue-title">
				通知队列
			</h2>
			<p className="text-muted-foreground text-xs">{totalItems} 条</p>
		</div>
	);
}

function QueuePagination({
	data,
	disabled,
	onPage,
}: {
	data: NoticeQueueData;
	disabled: boolean;
	onPage: (page: number) => void;
}) {
	const totalPages = Math.max(data.totalPages, 1);
	return (
		<div className="mt-4 flex items-center justify-between gap-3 text-muted-foreground text-sm">
			<p>
				第 {data.page} / {totalPages} 页
			</p>
			<div className="flex gap-2">
				<Button
					aria-label="上一页"
					disabled={disabled || data.page <= 1}
					onClick={() => onPage(data.page - 1)}
					size="sm"
					variant="outline"
				>
					<ChevronLeft className="size-4" />
					<span className="hidden sm:inline">上一页</span>
				</Button>
				<Button
					aria-label="下一页"
					disabled={disabled || data.page >= totalPages}
					onClick={() => onPage(data.page + 1)}
					size="sm"
					variant="outline"
				>
					<span className="hidden sm:inline">下一页</span>
					<ChevronRight className="size-4" />
				</Button>
			</div>
		</div>
	);
}

function NoticeQueueSkeleton() {
	return (
		<section aria-label="正在读取通知队列">
			<div className="mb-3 flex items-center justify-between">
				<Skeleton className="h-5 w-24" />
				<Skeleton className="h-4 w-12" />
			</div>
			<div className="overflow-hidden rounded-[var(--card-radius)] border border-border bg-card">
				{[0, 1, 2, 3, 4].map((item) => (
					<div className="grid gap-3 border-border border-b px-4 py-4 last:border-b-0" key={item}>
						<div className="flex justify-between gap-4">
							<Skeleton className="h-4 w-2/3" />
							<Skeleton className="h-5 w-16" />
						</div>
						<Skeleton className="h-3 w-1/2" />
						<Skeleton className="h-3 w-1/3" />
					</div>
				))}
			</div>
		</section>
	);
}
