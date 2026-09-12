import { prepareNoticeContentHtml } from "@campus-agent/notices/browser";
import { Button, buttonVariants, Skeleton } from "@campus-agent/ui";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, File } from "lucide-react";
import { memo, useEffect, useMemo, useRef } from "react";
import { NoticePreviewSchema } from "../../shared/notice-preview-contract";
import { fetchJson } from "../ops-api/core";
import { ErrorState, InlineError } from "../ops-display";

export function NoticePreviewPanel({
	noticeId,
	active = true,
}: {
	noticeId: number;
	active?: boolean;
}) {
	const attachmentsHeading = useRef<HTMLHeadingElement>(null);
	const jumpToAttachments = () => {
		const heading = attachmentsHeading.current;
		const scroll = heading?.closest<HTMLElement>("[data-notice-scroll]");
		if (!(heading && scroll)) {
			return;
		}
		const tabsHeight =
			scroll.querySelector('[role="tablist"]')?.getBoundingClientRect().height ?? 0;
		scroll.scrollTo({
			top:
				scroll.scrollTop +
				heading.getBoundingClientRect().top -
				scroll.getBoundingClientRect().top -
				tabsHeight -
				12,
			behavior: "instant",
		});
		heading.focus({ preventScroll: true });
	};
	const query = useQuery({
		enabled: active,
		queryKey: ["notice-preview", noticeId],
		queryFn: async ({ signal }) =>
			NoticePreviewSchema.parse(
				await fetchJson(`/api/ops/notices/${noticeId}/preview`, { signal }),
			),
	});
	const prepared = useMemo(
		() =>
			query.data
				? prepareNoticeContentHtml(query.data.contentHtml, query.data.images, { audience: "ops" })
				: null,
		[query.data],
	);
	const imageCount = query.data?.images.length ?? 0;
	const hasAttachments = (query.data?.attachments.length ?? 0) > 0;
	return (
		<section aria-label="通知正文" className="notice-preview min-w-0 space-y-5">
			{query.isPending ? (
				<div role="status" aria-label="正在读取正文" className="space-y-3">
					<p className="text-sm text-muted-foreground">正在读取正文…</p>
					<Skeleton className="h-5 w-full" />
					<Skeleton className="h-5 w-4/5" />
					<Skeleton className="h-40 w-full" />
				</div>
			) : null}
			{query.isError && !query.data ? (
				<ErrorState error={query.error} title="正文读取失败" onRetry={() => void query.refetch()} />
			) : null}
			{query.isError && query.data ? (
				<div className="space-y-2">
					<InlineError error={query.error} title="正文刷新失败" />
					<Button
						size="sm"
						variant="outline"
						disabled={query.isFetching}
						onClick={() => void query.refetch()}
					>
						{query.isFetching ? "重试中…" : "重试刷新"}
					</Button>
				</div>
			) : null}
			{query.data?.isExternal && query.data.externalUrl ? (
				<div className="space-y-3">
					<p className="break-words text-sm text-muted-foreground">
						外链通知 · {new URL(query.data.externalUrl).hostname}
					</p>
					<Button asChild variant="outline">
						<a href={query.data.externalUrl} target="_blank" rel="noopener noreferrer">
							打开原始链接
							<ExternalLink aria-hidden="true" />
						</a>
					</Button>
				</div>
			) : null}
			{imageCount > 0 || hasAttachments ? (
				<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
					{imageCount > 0 ? <span>图片 {imageCount}</span> : null}
					{imageCount > 0 && hasAttachments ? <span aria-hidden="true">·</span> : null}
					{hasAttachments ? (
						<button
							type="button"
							onClick={jumpToAttachments}
							className="min-h-11 rounded px-2 text-link underline underline-offset-4 hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							附件 {query.data?.attachments.length}
						</button>
					) : null}
				</div>
			) : null}
			{prepared?.status === "ready" ? <PreviewBody key={noticeId} html={prepared.html} /> : null}
			{prepared?.status === "empty" && !query.data?.isExternal ? (
				<p className="text-sm text-muted-foreground">
					这条通知没有正文。{hasAttachments ? "可查看下方附件。" : ""}
				</p>
			) : null}
			{prepared?.status === "invalid" ? (
				<p role="alert">正文暂时无法展示。{hasAttachments ? "可查看下方附件。" : ""}</p>
			) : null}
			{query.data && query.data.attachments.length > 0 ? (
				<section aria-label="附件" className="border-t pt-4">
					<h3
						ref={attachmentsHeading}
						tabIndex={-1}
						className="rounded font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						附件
					</h3>
					<ul className="mt-2 divide-y">
						{query.data.attachments.map((a) => (
							<li key={a.ordinal}>
								<a
									aria-label={a.name?.trim() || `附件 ${a.ordinal + 1}`}
									className="flex min-h-11 min-w-0 items-center gap-3 rounded-lg px-3 py-3 text-link hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
									href={a.url}
									target="_blank"
									rel="noopener noreferrer"
								>
									<File aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
									<span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
										<span className="block text-sm underline underline-offset-4">
											{a.name?.trim() || `附件 ${a.ordinal + 1}`}
										</span>
										{a.suffix?.trim() ? (
											<span className="text-xs text-muted-foreground">
												{a.suffix.trim().replace(/^\./, "").toUpperCase()}
											</span>
										) : null}
									</span>
									<ExternalLink
										aria-hidden="true"
										className="size-4 shrink-0 text-muted-foreground"
									/>
								</a>
							</li>
						))}
					</ul>
				</section>
			) : null}
		</section>
	);
}

const PreviewBody = memo(function PreviewBody({ html }: { html: string }) {
	const root = useRef<HTMLDivElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: React replaces the inner HTML when html changes; rebind image links to the new DOM.
	useEffect(() => {
		const cleanups: (() => void)[] = [];
		for (const [index, img] of [...(root.current?.querySelectorAll("img") ?? [])].entries()) {
			const wrapper = document.createElement("span");
			wrapper.className = "notice-preview-image";
			const link = document.createElement("a");
			link.href = img.src;
			link.target = "_blank";
			link.rel = "noopener noreferrer";
			const label = img.alt || `图片 ${index + 1}`;
			link.setAttribute("aria-label", `查看原图：${label}`);
			const actions = document.createElement("span");
			actions.className = "notice-preview-image-actions";
			const original = document.createElement("span");
			original.textContent = "查看原图";
			original.className = "notice-preview-image-open";
			const status = document.createElement("span");
			status.setAttribute("role", "status");
			const retry = document.createElement("button");
			retry.type = "button";
			retry.className = buttonVariants({ variant: "outline", size: "sm" });
			retry.textContent = "重试";
			retry.setAttribute("aria-label", `重试${label}`);
			retry.hidden = true;
			img.before(wrapper);
			link.append(img, original);
			actions.append(status, retry);
			actions.hidden = true;
			wrapper.append(link, actions);
			const error = () => {
				img.hidden = true;
				actions.hidden = false;
				wrapper.dataset.failed = "true";
				status.textContent = "图片加载失败";
				retry.hidden = false;
				retry.disabled = false;
			};
			const loaded = () => {
				img.hidden = false;
				actions.hidden = true;
				delete wrapper.dataset.failed;
				status.textContent = "";
				retry.hidden = true;
				retry.disabled = false;
			};
			const reload = () => {
				retry.disabled = true;
				status.textContent = "正在重试…";
				img.removeAttribute("src");
				img.src = link.href;
			};
			img.addEventListener("error", error);
			img.addEventListener("load", loaded);
			retry.addEventListener("click", reload);
			if (img.complete && img.naturalWidth === 0) {
				error();
			}
			cleanups.push(() => {
				img.removeEventListener("error", error);
				img.removeEventListener("load", loaded);
				retry.removeEventListener("click", reload);
				wrapper.replaceWith(img);
				img.hidden = false;
			});
		}
		return () => {
			for (const cleanup of cleanups) {
				cleanup();
			}
		};
	}, [html]);
	return (
		<div
			ref={root}
			className="notice-content max-w-none"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: shared browser parser validates tags, attributes and image references.
			dangerouslySetInnerHTML={{ __html: html }}
		/>
	);
});
