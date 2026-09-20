import { ActionGroup, Button } from "@campus-agent/ui";
import { Link, useNavigate } from "@tanstack/react-router";
import type { NoticeListItem, NoticeListResponse } from "campus-contracts/notices";
import {
	ArrowLeft,
	ArrowRight,
	ArrowUpRight,
	ChevronRight,
	FileText,
	Globe2,
	Landmark,
	MessageCircle,
	Newspaper,
	School,
} from "lucide-react";
import { useState } from "react";
import { NoticeCategoryBadge } from "@/features/notices/category-badge";
import {
	describeExternalNoticeSource,
	type ExternalNoticeSourceKind,
} from "@/features/notices/external-source";
import { formatTimestamp } from "@/lib/date-time";

export function NoticeResults({
	data,
	itemLabel,
	pending,
}: {
	data: NoticeListResponse;
	itemLabel: string;
	pending: boolean;
}) {
	const navigate = useNavigate({ from: "/notices" });
	const [pageInput, setPageInput] = useState(String(data.pagination.page));
	const totalPages = Math.max(1, data.pagination.totalPages);
	const jump = () => {
		const page = Number(pageInput);
		if (!Number.isInteger(page) || page < 1 || page > totalPages) {
			return;
		}
		void navigate({ search: (previous) => ({ ...previous, page }) });
	};
	return (
		<div className={pending ? "opacity-60" : undefined}>
			<ul className="space-y-1 py-1" data-testid="notice-list">
				{data.items.map((item) => (
					<li key={item.noticeId}>
						<NoticeRow item={item} />
					</li>
				))}
			</ul>
			{data.items.length === 0 && data.pagination.totalItems > 0 ? (
				<p className="border-t border-border px-3 py-3 text-sm text-destructive">
					当前页已超出范围，请前往最后一页。
				</p>
			) : null}
			<nav
				aria-label={`${itemLabel}分页`}
				className="mt-2 flex min-h-14 items-center justify-between gap-4 border-t border-border"
			>
				<p className="text-sm tabular-nums text-[var(--sys-text-muted)]">
					第 {data.pagination.page} / {totalPages} 页
				</p>
				<div className="flex items-center gap-2">
					<label className="sr-only" htmlFor="notice-page-jump">
						跳转页码
					</label>
					<input
						id="notice-page-jump"
						inputMode="numeric"
						min={1}
						max={totalPages}
						value={pageInput}
						onChange={(event) => setPageInput(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								jump();
							}
						}}
						className="h-8 w-16 rounded border bg-background px-2 text-sm"
					/>
					<Button disabled={pending} onClick={jump} size="sm" variant="outline">
						跳转
					</Button>
				</div>
				<ActionGroup>
					<Button
						disabled={pending || data.pagination.page <= 1}
						onClick={() =>
							void navigate({
								search: (previous) => ({ ...previous, page: previous.page - 1 }),
							})
						}
						size="sm"
						variant="ghost"
					>
						<ArrowLeft />
						上一页
					</Button>
					<Button
						disabled={pending || data.pagination.page >= totalPages}
						onClick={() =>
							void navigate({
								search: (previous) => ({ ...previous, page: previous.page + 1 }),
							})
						}
						size="sm"
						variant="ghost"
					>
						下一页
						<ArrowRight />
					</Button>
				</ActionGroup>
			</nav>
		</div>
	);
}

function NoticeRow({ item }: { item: NoticeListItem }) {
	const externalSource = item.isExternal ? describeExternalNoticeSource(item.externalUrl) : null;
	const source = externalSource
		? {
				...externalSource,
				title: `外链来源：${externalSource.label}（${externalSource.hostname}）`,
			}
		: { kind: "campus" as const, label: "校内门户", title: "通知来源：校内门户" };
	const content = (
		<div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-3 py-3.5">
			<h2 className="min-w-0 break-words text-[15px] font-medium leading-6 tracking-normal text-[var(--sys-text-strong)] group-hover:text-link sm:text-base">
				{item.title}
			</h2>
			<span
				aria-hidden="true"
				className="mt-1 flex size-4 items-center justify-center text-[var(--sys-text-muted)]"
			>
				{item.isExternal ? (
					<ArrowUpRight className="size-4" />
				) : (
					<ChevronRight className="size-4" />
				)}
			</span>
			<div className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
				<NoticeCategoryBadge category={item.category} className="font-medium" />
				{item.category === "unclassified" ? (
					<span className="text-xs text-muted-foreground">未分类</span>
				) : null}
				<time
					className="whitespace-nowrap text-xs tabular-nums text-[var(--sys-text-muted)]"
					dateTime={item.releasedAt}
				>
					{formatTimestamp(item.releasedAt)}
				</time>
				<NoticeMetadata
					organization={item.organization?.name ?? "发布部门未标注"}
					source={source}
				/>
			</div>
		</div>
	);
	const className =
		"group block rounded-lg transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
	if (item.isExternal) {
		return (
			<a className={className} href={item.externalUrl} rel="noopener noreferrer" target="_blank">
				{content}
			</a>
		);
	}
	return (
		<Link className={className} params={{ noticeId: item.noticeId }} to="/notices/$noticeId">
			{content}
		</Link>
	);
}

const NOTICE_SOURCE_ICONS = {
	campus: School,
	document: FileText,
	media: Newspaper,
	procurement: Landmark,
	website: Globe2,
	wechat: MessageCircle,
} as const satisfies Record<ExternalNoticeSourceKind, typeof Globe2>;

function NoticeMetadata({
	organization,
	source,
}: {
	organization: string;
	source: { kind: ExternalNoticeSourceKind; label: string; title: string };
}) {
	const SourceIcon = NOTICE_SOURCE_ICONS[source.kind];
	return (
		<p className="contents text-xs text-[var(--sys-text-muted)]">
			<span className="inline-flex min-w-0 max-w-full items-center gap-2">
				<span aria-hidden="true" className="text-border">
					·
				</span>
				<span className="break-words">{organization}</span>
			</span>
			{source.kind === "campus" ? null : (
				<span className="inline-flex min-w-0 max-w-full items-center gap-1.5" title={source.title}>
					<span aria-hidden="true" className="text-border">
						·
					</span>
					<SourceIcon aria-hidden="true" className="size-3.5 shrink-0" />
					<span className="truncate">{source.label}</span>
				</span>
			)}
		</p>
	);
}
