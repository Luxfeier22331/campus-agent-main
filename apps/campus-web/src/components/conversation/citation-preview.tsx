import { createContext, useContext, useRef, useState } from "react";
import { NoticePreviewDialog } from "@/components/notices/notice-preview-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { SourceItemPayload } from "@/features/conversation/model";
import { SourceItemCard } from "./source-items";

export const CitationSourcesContext = createContext<ReadonlyMap<number, SourceItemPayload>>(
	new Map(),
);

export function CitationPreview({ index }: { index: number }) {
	const source = useContext(CitationSourcesContext).get(index);
	const [open, setOpen] = useState(false);
	const [previewOpen, setPreviewOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const restoringFocus = useRef(false);
	if (!source?.primaryAction.href) {
		return (
			<sup
				role="img"
				className="mx-0.5 text-xs text-muted-foreground"
				title="来源不可用"
				aria-label={`引用 ${index}：来源不可用`}
			>
				[{index}]
			</sup>
		);
	}
	return (
		<>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<button
						ref={triggerRef}
						type="button"
						className="mx-0.5 inline-flex rounded px-1 align-super text-xs text-link hover:bg-accent focus-visible:outline"
						aria-label={`查看引用 ${index}：${source.title}`}
						onFocus={(event) => {
							if (!restoringFocus.current && event.currentTarget.matches(":focus-visible")) {
								setOpen(true);
							}
						}}
					>
						[{index}]
					</button>
				</PopoverTrigger>
				<PopoverContent
					className="w-80 p-0"
					onOpenAutoFocus={(event) => event.preventDefault()}
					onCloseAutoFocus={(event) => {
						if (previewOpen) {
							event.preventDefault();
							return;
						}
						restoringFocus.current = true;
						queueMicrotask(() => {
							restoringFocus.current = false;
						});
					}}
				>
					<p className="px-3 pt-2 text-xs text-muted-foreground">
						{source.kind === "web_page"
							? "公开网页"
							: source.kind === "campus_notice"
								? "校园通知"
								: "校内文档"}
					</p>
					<SourceItemCard
						sourceItem={source}
						onPreviewNotice={() => {
							setOpen(false);
							setPreviewOpen(true);
						}}
					/>
				</PopoverContent>
			</Popover>
			{source.kind === "campus_notice" ? (
				<NoticePreviewDialog
					noticeId={source.noticeId}
					title={source.title}
					open={previewOpen}
					onOpenChange={setPreviewOpen}
					restoreFocus={() => {
						restoringFocus.current = true;
						triggerRef.current?.focus({ preventScroll: true });
						queueMicrotask(() => {
							restoringFocus.current = false;
						});
					}}
				/>
			) : null}
		</>
	);
}
