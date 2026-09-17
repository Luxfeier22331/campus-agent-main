import type { DiningMySubmission } from "@campus-agent/dining/domain";
import { Button, SheetDescription, SheetHeader, SheetTitle } from "@campus-agent/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronRight, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { AuthDialog } from "@/components/auth/auth-dialog";
import { diningSubmissionsInfiniteQueryOptions } from "@/features/dining/submission-queries";
import { useCampusSession } from "@/platform/auth/session";
import { AdaptiveSheetSurface } from "./dining-overlay-surface";
import { useDiningSubmissionExit } from "./dining-submission-exit";
import { DiningSubmissionForm } from "./dining-submission-form";
import { DiningSubmissionPhoto } from "./dining-submission-photo";
import { DiningSubmissionSkeleton } from "./dining-submission-skeleton";

export function DiningWindowSubmissions(props: {
	windowId: string;
	windowName: string;
	onOpen(submissionId: string): void;
	onSaved(submission: DiningMySubmission): void;
}) {
	const session = useCampusSession();
	const { requestExit } = useDiningSubmissionExit();
	const [createOpen, setCreateOpen] = useState(false);
	const createTrigger = useRef<HTMLButtonElement>(null);
	const [authOpen, setAuthOpen] = useState(false);
	const submissions = useInfiniteQuery(
		diningSubmissionsInfiniteQueryOptions(props.windowId, session.data?.user.id ?? null),
	);
	const items = submissions.data?.pages.flatMap((page) => page.items) ?? [];
	return (
		<section className="mt-5 border-t border-border pt-4" aria-label="用户投稿">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="text-sm font-semibold">用户投稿</h3>
				<Button
					ref={createTrigger}
					className="min-h-11"
					size="sm"
					variant="outline"
					disabled={session.status === "loading" || session.status === "unavailable"}
					onClick={() =>
						session.status === "authenticated" ? setCreateOpen(true) : setAuthOpen(true)
					}
				>
					<Plus />
					投稿
				</Button>
			</div>
			<p className="mt-1 text-xs text-muted-foreground">同学分享的菜品，供你参考。</p>
			{session.status === "unavailable" ? (
				<Button className="mt-2 min-h-11" variant="outline" onClick={() => void session.refresh()}>
					重试登录状态
				</Button>
			) : null}
			{submissions.isPending ? <DiningSubmissionSkeleton label="正在读取投稿" /> : null}
			{submissions.isError ? (
				<div className="py-4" role="alert">
					<p className="text-sm text-destructive">
						{submissions.data ? "刷新失败，当前显示上次读取的投稿。" : "投稿暂时无法读取。"}
					</p>
					<Button
						className="mt-2 min-h-11"
						variant="outline"
						onClick={() => void submissions.refetch()}
					>
						重试投稿
					</Button>
				</div>
			) : null}
			{submissions.data && items.length === 0 ? (
				<p className="py-6 text-sm text-muted-foreground">暂无用户投稿</p>
			) : (
				<ul className="divide-y divide-border">
					{items.map((item) => (
						<li key={item.submissionId}>
							<DiningSubmissionPhotoLink item={item} onOpen={props.onOpen} />
						</li>
					))}
				</ul>
			)}
			{submissions.hasNextPage ? (
				<Button
					className="mt-3 min-h-11 w-full"
					disabled={submissions.isFetchingNextPage}
					variant="outline"
					onClick={() => void submissions.fetchNextPage()}
				>
					{submissions.isFetchingNextPage ? "读取中" : "更多投稿"}
				</Button>
			) : null}
			<AdaptiveSheetSurface
				desktopClassName="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
				mobileClassName="gap-0"
				open={createOpen && session.status === "authenticated"}
				onOpenChange={(open) =>
					open ? setCreateOpen(true) : requestExit(() => setCreateOpen(false))
				}
				onCloseAutoFocus={(event) => {
					if (createTrigger.current?.isConnected) {
						event.preventDefault();
						createTrigger.current.focus();
					}
				}}
			>
				<SheetHeader className="border-b border-border p-5 pr-12 text-left">
					<SheetTitle>发布用户投稿</SheetTitle>
					<SheetDescription>{props.windowName}</SheetDescription>
				</SheetHeader>
				<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5" data-vaul-no-drag="">
					{createOpen && session.status === "authenticated" ? (
						<DiningSubmissionForm
							key={`${props.windowId}:${session.data?.user.id}`}
							windowId={props.windowId}
							windowName={props.windowName}
							onCancel={() => setCreateOpen(false)}
							onSaved={(submission) => {
								setCreateOpen(false);
								props.onSaved(submission);
							}}
						/>
					) : null}
				</div>
			</AdaptiveSheetSurface>
			{authOpen ? (
				<AuthDialog open onOpenChange={setAuthOpen} onAuthenticated={() => setCreateOpen(true)} />
			) : null}
		</section>
	);
}

function DiningSubmissionPhotoLink({
	item,
	onOpen,
}: {
	item: import("@campus-agent/dining/domain").DiningSubmission;
	onOpen(id: string): void;
}) {
	const link = (photo: import("react").ReactNode) => (
		<a
			className="flex min-h-16 items-center gap-3 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			data-submission-id={item.submissionId}
			href={`/dining?submission=${encodeURIComponent(item.submissionId)}`}
			onClick={(event) => {
				if (
					!(event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) &&
					event.button === 0
				) {
					event.preventDefault();
					onOpen(item.submissionId);
				}
			}}
		>
			{photo}
			<div className="min-w-0 flex-1">
				<p className="break-words font-medium">{item.name}</p>
				<p className="mt-1 break-words text-xs text-muted-foreground">
					用户投稿 · {item.authorName}
				</p>
				<p className="mt-1 break-words text-xs text-muted-foreground">
					{item.priceText ?? "价格暂未提供"}
				</p>
			</div>
			<ChevronRight className="size-4 shrink-0" />
		</a>
	);
	return item.photo ? (
		<DiningSubmissionPhoto
			key={item.photo.url}
			compact
			name={item.name}
			photo={item.photo}
			renderLink={link}
		/>
	) : (
		link(null)
	);
}
