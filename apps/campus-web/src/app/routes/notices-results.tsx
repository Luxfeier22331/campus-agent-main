import { Button } from "@campus-agent/ui";
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
import { NoticeCategoryBadge } from "@/features/notices/category-badge";
import {
	describeExternalNoticeSource,
	type ExternalNoticeSourceKind,
} from "@/features/notices/external-source";

const RELEASE_DATE_FORMATTER = new Intl.DateTimeFormat("sv-SE", {
	day: "2-digit",
	hour: "2-digit",
	hourCycle: "h23",
	minute: "2-digit",
	month: "2-digit",
	timeZone: "Asia/Shanghai",
	year: "numeric",
});

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
	return (
		<div className={pending ? "opacity-60" : undefined}>
			<ul className="space-y-1 py-1" data-testid="notice-list">
				{data.items.map((item) => (
					<li key={item.noticeId}>
						<NoticeRow item={item} />
					</li>
				))}
			</ul>
			<nav
				aria-label={`${itemLabel}分页`}
				className="mt-2 flex min-h-14 items-center justify-between gap-4 border-t border-border"
			>
				<p className="text-sm tabular-nums text-[var(--sys-text-muted)]">
					第 {data.pagination.page} / {data.pagination.totalPages} 页
				</p>
				<div className="flex gap-1">
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
						disabled={pending || data.pagination.page >= data.pagination.totalPages}
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
				</div>
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
				<time
					className="whitespace-nowrap text-xs tabular-nums text-[var(--sys-text-muted)]"
					dateTime={item.releasedAt}
				>
					{RELEASE_DATE_FORMATTER.format(new Date(item.releasedAt))}
				</time>
				<NoticeMetadata
					organization={item.organization?.name ?? "发布部门未标注"}
					source={source}
					type={item.noticeType.name}
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
	type,
}: {
	organization: string;
	source: { kind: ExternalNoticeSourceKind; label: string; title: string };
	type: string;
}) {
	const SourceIcon = NOTICE_SOURCE_ICONS[source.kind];
	return (
		<p className="contents text-xs text-[var(--sys-text-muted)]">
			<span className="inline-flex min-w-0 max-w-full items-center gap-1.5" title={source.title}>
				<span aria-hidden="true" className="text-border">
					·
				</span>
				<SourceIcon aria-hidden="true" className="size-3.5 shrink-0" />
				<span className="truncate">{source.label}</span>
			</span>
			<span className="inline-flex min-w-0 max-w-full items-center gap-2 text-xs text-[var(--sys-text-muted)]">
				<span aria-hidden="true" className="text-border">
					·
				</span>
				<span className="break-words">{organization}</span>
			</span>
			<span className="inline-flex min-w-0 max-w-full items-center gap-2 text-xs text-[var(--sys-text-muted)]">
				<span aria-hidden="true" className="text-border">
					·
				</span>
				<span className="break-words">门户栏目：{type}</span>
			</span>
		</p>
	);
}
