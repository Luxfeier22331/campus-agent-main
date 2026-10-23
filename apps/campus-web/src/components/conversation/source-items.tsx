import type { DataMessagePartProps } from "@assistant-ui/react";
import { formatDocsVersionLabel } from "campus-contracts/campus-docs";
import { Globe2 } from "lucide-react";
import { useRef, useState } from "react";
import { NoticePreviewDialog } from "@/components/notices/notice-preview-dialog";
import type { SourceItemPayload } from "@/features/conversation/model";

export interface SourceItemsPayload {
	sourceItems: SourceItemPayload[];
	type: "source_items";
}

export function SourceItemsDataPart({ data }: DataMessagePartProps<SourceItemsPayload>) {
	return <SourceItemsList sourceItems={data.sourceItems} />;
}

export function SourceItemsList({ sourceItems }: { sourceItems: SourceItemPayload[] }) {
	const [expanded, setExpanded] = useState(false);
	if (sourceItems.length === 0) {
		return null;
	}
	const visibleSourceItems = expanded ? sourceItems : sourceItems.slice(0, 5);

	return (
		<section aria-label="来源" className="mt-3 flex flex-col gap-2">
			{visibleSourceItems.map((sourceItem) => (
				<SourceItemCard key={sourceItemKey(sourceItem)} sourceItem={sourceItem} />
			))}
			{sourceItems.length > 5 ? (
				<button
					aria-expanded={expanded}
					className="text-muted-foreground hover:text-foreground self-start text-xs font-medium transition-colors"
					onClick={() => setExpanded((current) => !current)}
					type="button"
				>
					{expanded ? "收起来源" : `查看其余 ${sourceItems.length - 5} 个来源`}
				</button>
			) : null}
		</section>
	);
}

function sourceItemKey(sourceItem: SourceItemPayload) {
	return [
		sourceItem.kind,
		sourceItem.citationIndexes.join(","),
		sourceItem.primaryAction.href,
		sourceItem.title,
	]
		.filter(Boolean)
		.join(":");
}

export function SourceItemCard({
	sourceItem,
	onPreviewNotice,
}: {
	sourceItem: SourceItemPayload;
	onPreviewNotice?: () => void;
}) {
	const [previewOpen, setPreviewOpen] = useState(false);
	const previewTrigger = useRef<HTMLButtonElement>(null);
	const metadata =
		sourceItem.kind === "web_page"
			? isGroundingRedirect(sourceItem.primaryAction.href)
				? []
				: [sourceItem.hostname].filter(Boolean)
			: sourceItem.kind === "campus_notice"
				? ["校园通知"]
				: [sourceItem.collectionLabel, formatDocsVersionLabel(sourceItem.versionSlug)].filter(
						Boolean,
					);

	return (
		<>
			<div className="border-border/70 bg-surface-muted/20 rounded-md border px-3 py-2">
				<div className="flex min-w-0 items-start justify-between gap-3">
					<div className="flex min-w-0 items-start gap-2">
						<span
							aria-label={`引用 ${sourceItem.citationIndexes.join("、")}`}
							className="text-muted-foreground shrink-0 text-sm font-medium"
							role="img"
						>
							{sourceItem.citationIndexes.map((index) => `[${index}]`).join(" ")}
						</span>
						<SourceFavicon
							href={sourceItem.kind === "web_page" ? sourceItem.primaryAction.href : null}
						/>
						<div className="min-w-0">
							<p className="text-foreground line-clamp-2 text-sm font-medium">{sourceItem.title}</p>
							{metadata.length > 0 ? (
								<p className="text-muted-foreground mt-1 line-clamp-1 text-xs">
									{metadata.join(" · ")}
								</p>
							) : null}
						</div>
					</div>
					{sourceItem.kind === "campus_notice" ? (
						<button
							ref={previewTrigger}
							type="button"
							aria-haspopup="dialog"
							className="border-border text-foreground hover:bg-accent hover:text-accent-foreground inline-flex h-8 shrink-0 items-center rounded-md border px-2 text-xs font-medium transition-colors"
							onClick={() => (onPreviewNotice ? onPreviewNotice() : setPreviewOpen(true))}
						>
							查看通知
						</button>
					) : (
						<SourceItemAction sourceItem={sourceItem} />
					)}
				</div>
				{(sourceItem.kind === "campus_document" || sourceItem.kind === "campus_notice") &&
				sourceItem.sectionTitle ? (
					<p className="text-muted-foreground mt-1 line-clamp-1 text-xs">
						{sourceItem.sectionTitle}
					</p>
				) : null}
				{sourceItem.snippet ? (
					<p className="text-muted-foreground mt-2 line-clamp-3 text-sm">{sourceItem.snippet}</p>
				) : null}
			</div>
			{sourceItem.kind === "campus_notice" && !onPreviewNotice ? (
				<NoticePreviewDialog
					noticeId={sourceItem.noticeId}
					title={sourceItem.title}
					open={previewOpen}
					onOpenChange={setPreviewOpen}
					restoreFocus={() => previewTrigger.current?.focus({ preventScroll: true })}
				/>
			) : null}
		</>
	);
}

function SourceFavicon({ href }: { href: string | null }) {
	const [failed, setFailed] = useState(false);
	const favicon = sourceFaviconUrl(href);

	if (!favicon || failed) {
		return <Globe2 aria-hidden="true" className="text-muted-foreground size-4 shrink-0" />;
	}

	return (
		<img
			alt=""
			className="size-4 shrink-0 rounded-sm object-contain"
			decoding="async"
			loading="lazy"
			onError={() => setFailed(true)}
			referrerPolicy="no-referrer"
			src={favicon}
		/>
	);
}

function sourceFaviconUrl(href: string | null): string | null {
	if (!href || isGroundingRedirect(href)) {
		return null;
	}
	try {
		const url = new URL(href);
		if (
			(url.protocol !== "https:" && url.protocol !== "http:") ||
			!url.hostname ||
			url.username ||
			url.password
		) {
			return null;
		}
		return `${url.origin}/favicon.ico`;
	} catch {
		return null;
	}
}

function SourceItemAction({ sourceItem }: { sourceItem: SourceItemPayload }) {
	const action = sourceItem.primaryAction;
	if (action.href === null) {
		return <span className="text-muted-foreground shrink-0 text-xs">来源暂不可用</span>;
	}
	return (
		<a
			className="border-border text-foreground hover:bg-accent hover:text-accent-foreground inline-flex h-8 shrink-0 items-center rounded-md border px-2 text-xs font-medium transition-colors"
			href={action.href}
			rel={action.external ? "noopener noreferrer" : undefined}
			target={action.external ? "_blank" : undefined}
		>
			{action.label}
		</a>
	);
}

function isGroundingRedirect(href: string | null): boolean {
	if (!href) {
		return false;
	}
	try {
		const url = new URL(href);
		return (
			url.hostname === "vertexaisearch.cloud.google.com" &&
			url.pathname.startsWith("/grounding-api-redirect/")
		);
	} catch {
		return false;
	}
}
