import type { DiningMySubmission } from "@campus-agent/dining/domain";
import { ActionGroup, Button, ConfirmDialog, StateMessage } from "@campus-agent/ui";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AuthDialog } from "@/components/auth/auth-dialog";
import { deleteDiningSubmission } from "@/features/dining/submission-api";
import { submissionErrorMessage } from "@/features/dining/submission-error";
import {
	invalidateDiningSubmissions,
	myDiningSubmissionsInfiniteQueryOptions,
} from "@/features/dining/submission-queries";
import { ApiRequestError } from "@/platform/api/client";
import { useCampusSession } from "@/platform/auth/session";
import { DiningSubmissionSkeleton } from "./dining-submission-skeleton";

const statusLabels = {
	public: "公开",
	hidden: "已隐藏",
	deleted: "已删除",
	expired: "已过期",
} as const;

export function DiningMySubmissions(props: {
	onOpenSubmission(submission: DiningMySubmission): void;
}) {
	const session = useCampusSession();
	return <MySubmissions key={session.data?.user.id ?? session.status} {...props} />;
}

function MySubmissions(props: { onOpenSubmission(submission: DiningMySubmission): void }) {
	const session = useCampusSession();
	const client = useQueryClient();
	const [deleting, setDeleting] = useState<DiningMySubmission | null>(null);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<Error | null>(null);
	const [authOpen, setAuthOpen] = useState(false);
	const listFocus = useRef<HTMLElement | null>(null);
	const active = useRef(true);
	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
		};
	}, []);
	const query = useInfiniteQuery(
		myDiningSubmissionsInfiniteQueryOptions(
			session.data?.user.id ?? null,
			session.status === "authenticated",
		),
	);
	if (session.status === "loading") {
		return <StateMessage layout="inline" role="status" description={<>正在确认登录状态</>} />;
	}
	if (session.status === "unavailable") {
		return (
			<div className="space-y-2">
				<StateMessage
					layout="inline"
					role="alert"
					tone="danger"
					description={<>暂时无法确认登录状态。</>}
				/>
				<Button
					disabled={session.isRefreshing}
					onClick={() => void session.refresh()}
					variant="outline"
				>
					重试
				</Button>
			</div>
		);
	}
	if (session.status !== "authenticated") {
		return (
			<div className="space-y-3">
				<p className="text-sm text-muted-foreground">请先登录后查看我的投稿。</p>
				<Button onClick={() => setAuthOpen(true)}>登录</Button>
				{authOpen ? <AuthDialog open onOpenChange={setAuthOpen} /> : null}
			</div>
		);
	}
	if (query.isPending) {
		return <DiningSubmissionSkeleton label="正在读取我的投稿" />;
	}
	if (query.isError && !query.data) {
		return (
			<div className="space-y-3">
				<StateMessage
					layout="inline"
					role="alert"
					tone="danger"
					description={<>暂时无法读取我的投稿。</>}
				/>
				<Button onClick={() => void query.refetch()} variant="outline">
					重试
				</Button>
			</div>
		);
	}
	const items = query.data?.pages.flatMap((page) => page.items) ?? [];
	const conflict = error instanceof ApiRequestError && error.status === 412;
	async function confirmDelete() {
		if (!deleting || pending || conflict) {
			return;
		}
		setPending(true);
		setError(null);
		try {
			await deleteDiningSubmission({
				submissionId: deleting.submissionId,
				revision: deleting.revision,
			});
			await invalidateDiningSubmissions(client);
			if (active.current) {
				setDeleting(null);
			}
		} catch (caught) {
			if (active.current) {
				setError(caught instanceof Error ? caught : new Error("删除未完成，请重试。"));
			}
		} finally {
			if (active.current) {
				setPending(false);
			}
		}
	}
	return (
		<section ref={listFocus} tabIndex={-1} aria-label="我的投稿" className="space-y-3">
			{query.isError ? (
				<div className="space-y-2">
					<StateMessage
						layout="inline"
						role="alert"
						tone="danger"
						description={<>刷新失败，当前显示上次读取的投稿。</>}
					/>
					<Button onClick={() => void query.refetch()} variant="outline">
						重试
					</Button>
				</div>
			) : null}
			{items.length === 0 ? (
				<p className="py-8 text-center text-sm text-muted-foreground">还没有投稿。</p>
			) : (
				<ul className="divide-y divide-border">
					{items.map((submission) => (
						<li className="space-y-3 py-4" key={submission.submissionId}>
							<div className="min-w-0">
								<p className="break-words font-medium">
									{"name" in submission
										? submission.name
										: submission.status === "deleted"
											? "已删除的投稿"
											: "已过期的投稿"}
								</p>
								<p className="mt-1 text-sm text-muted-foreground">
									用户投稿 ·{" "}
									{submission.status === "public" && !submission.windowAvailable
										? "停止公开"
										: statusLabels[submission.status]}{" "}
									·{" "}
									{new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(
										new Date(submission.createdAt),
									)}
								</p>
								{submission.windowAvailable ? null : (
									<p className="mt-1 text-sm text-muted-foreground">所属窗口当前不可用</p>
								)}
								{submission.status === "hidden" ? (
									<p className="mt-1 text-sm text-muted-foreground">
										已停止公开，编辑不会恢复展示。
									</p>
								) : null}
								{submission.status === "deleted" ? (
									<p className="mt-1 text-sm text-muted-foreground">
										删除已受理，仅运营可在期限内恢复。
									</p>
								) : null}
							</div>
							<ActionGroup>
								<Button
									data-submission-id={submission.submissionId}
									onClick={() => props.onOpenSubmission(submission)}
									size="sm"
									variant="outline"
								>
									{submission.canEdit ? "查看与编辑" : "查看状态"}
								</Button>
								{submission.canDelete ? (
									<Button
										onClick={() => {
											setDeleting(submission);
											setError(null);
										}}
										size="sm"
										variant="ghost"
									>
										删除投稿
									</Button>
								) : null}
							</ActionGroup>
						</li>
					))}
				</ul>
			)}
			{query.hasNextPage ? (
				<Button
					className="w-full"
					disabled={query.isFetchingNextPage}
					onClick={() => void query.fetchNextPage()}
					variant="outline"
				>
					{query.isFetchingNextPage ? "读取中" : "加载更多"}
				</Button>
			) : null}
			<ConfirmDialog
				open={Boolean(deleting)}
				onOpenChange={(open) => {
					if (!open) {
						setDeleting(null);
					}
				}}
				title="删除这条投稿？"
				description="删除后停止公开，仍计入当天新增数量。你不能自行恢复；仅运营可在删除后 30 天内且清理前恢复。"
				confirmLabel="确认删除"
				pendingLabel="正在删除"
				pending={pending}
				confirmDisabled={conflict}
				onConfirm={() => void confirmDelete()}
				fallbackFocusRef={listFocus}
				error={
					error
						? conflict
							? "投稿已发生变化，请重新读取列表后确认当前状态。"
							: submissionErrorMessage(error)
						: null
				}
			>
				{conflict ? (
					<Button
						variant="outline"
						onClick={() => {
							setDeleting(null);
							void query.refetch();
						}}
					>
						重新读取列表
					</Button>
				) : null}
			</ConfirmDialog>
		</section>
	);
}
