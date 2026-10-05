import type {
	DiningMenuItemRecord,
	DiningOpsContentReviewRecord,
} from "@campus-agent/dining/domain";
import {
	ActionGroup,
	Badge,
	Button,
	Checkbox,
	ConfirmDialog,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Field,
	Input,
	Label,
	StateMessage,
	Textarea,
} from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, FileClock, MessageSquarePlus, RefreshCw, Search, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { decodeCursorHistory, encodeCursorHistory } from "./account-admin-navigation";
import { DiningTaskNavigation, diningWindowOptions } from "./dining-navigation";
import type { DiningReviewsSearch } from "./dining-review-navigation";
import { formatTimestamp } from "./format";
import {
	createDiningReview,
	deleteDiningOperatorReview,
	fetchDiningMenuItems,
	fetchDiningReview,
	fetchDiningReviews,
	fetchDiningState,
	setDiningReviewVisible,
	updateDiningReview,
} from "./ops-api/dining";
import { ErrorState, InlineError, PageHeader } from "./ops-display";
import { FilterSelect } from "./ui/filter-select";
import { useConfirmCommand } from "./use-confirm-command";

type ReviewVisibility = "deleted" | "hidden" | "visible";

export function DiningReviewsPage({ search = {} }: { search?: DiningReviewsSearch } = {}) {
	const confirmCommand = useConfirmCommand();
	const queryClient = useQueryClient();
	const navigate = useNavigate({ from: "/dining/reviews" });
	const {
		cursor,
		q: query = "",
		menuItemId = "",
		targetType = "",
		submission_id: submissionId = "",
		visibility = "visible",
		reviewId: detailReviewId,
	} = search;
	const previousCursors = decodeCursorHistory(search.history);
	const [queryInput, setQueryInput] = useState(query);
	const [submissionInput, setSubmissionInput] = useState(submissionId);
	useEffect(() => setQueryInput(query), [query]);
	useEffect(() => setSubmissionInput(submissionId), [submissionId]);
	const changeFilters = (next: DiningReviewsSearch) =>
		void navigate({
			search: { ...search, cursor: undefined, history: undefined, reviewId: undefined, ...next },
		});
	const setDetailReviewId = (id: string | null) =>
		void navigate({ search: { ...search, reviewId: id ?? undefined } });
	const [creating, setCreating] = useState(false);
	const menu = useQuery({
		queryFn: ({ signal }) => fetchDiningMenuItems({ signal }),
		queryKey: ["dining", "menu-items"],
	});
	const state = useQuery({
		queryKey: ["dining", "state"],
		queryFn: ({ signal }) => fetchDiningState({ signal }),
	});
	const windowLabels = new Map(
		state.data
			? diningWindowOptions(state.data.draft.bundle).map((window) => [
					window.windowId,
					window.label,
				])
			: [],
	);
	const reviews = useQuery({
		queryFn: ({ signal }) =>
			fetchDiningReviews(
				{
					...(cursor ? { cursor } : {}),
					limit: 50,
					...(menuItemId ? { menuItemId } : {}),
					...(targetType ? { targetType } : {}),
					...(submissionId.trim() ? { submissionId: submissionId.trim() } : {}),
					...(query ? { q: query } : {}),
					visibility,
				},
				{ signal },
			),
		queryKey: [
			"dining",
			"reviews",
			cursor,
			menuItemId,
			query,
			visibility,
			targetType,
			submissionId,
		],
	});
	const visibilityMutation = useMutation({
		mutationFn: (input: { reviewId: string; visible: boolean }) =>
			setDiningReviewVisible(input.reviewId, input.visible),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dining", "reviews"] }),
	});
	const deleteMutation = useMutation({
		mutationFn: deleteDiningOperatorReview,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dining", "reviews"] }),
	});

	const activeMenuItems = menu.data?.items.filter((item) => item.archivedAt === null) ?? [];

	const renderActions = (review: DiningOpsContentReviewRecord) => (
		<div className="grid gap-2">
			<ActionGroup className="justify-start sm:justify-end">
				<Button
					aria-label={`查看评价 ${review.reviewId}`}
					onClick={() => setDetailReviewId(review.reviewId)}
					size="sm"
					variant="ghost"
				>
					<FileClock className="size-4" />
					查看详情
				</Button>
				{review.deletedAt ? null : (
					<Button
						aria-label={`${review.hiddenAt ? "公开" : "隐藏"}评价 ${review.reviewId}`}
						disabled={visibilityMutation.isPending}
						onClick={() =>
							visibilityMutation.mutate({
								reviewId: review.reviewId,
								visible: Boolean(review.hiddenAt),
							})
						}
						size="sm"
						variant="ghost"
					>
						{review.hiddenAt ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
						{review.hiddenAt ? "公开" : "隐藏"}
					</Button>
				)}
				{review.authorKind === "operator" && !review.deletedAt ? (
					<ConfirmDialog
						confirmLabel="删除"
						description="评价会从学生端移除并保留数据库记录，删除后不能编辑。"
						{...confirmCommand(`${review.reviewId}-actions`, () =>
							deleteMutation.mutateAsync(review.reviewId),
						)}
						title="删除这条运维录入评价？"
						trigger={
							<Button
								aria-label={`删除评价 ${review.reviewId}`}
								disabled={deleteMutation.isPending}
								size="sm"
								variant="ghost"
							>
								<Trash2 className="size-4" />
								删除
							</Button>
						}
					/>
				) : null}
			</ActionGroup>
			{visibilityMutation.error && visibilityMutation.variables?.reviewId === review.reviewId ? (
				<InlineError error={visibilityMutation.error} title="评价状态修改失败" />
			) : null}
		</div>
	);

	return (
		<section className="mx-auto w-full max-w-[1600px]">
			<DiningTaskNavigation />
			<PageHeader
				actions={
					<ActionGroup>
						<Button
							aria-label="刷新评价"
							disabled={reviews.isFetching}
							onClick={() => void reviews.refetch()}
							size="icon"
							variant="ghost"
						>
							<RefreshCw className={`size-4 ${reviews.isFetching ? "animate-spin" : ""}`} />
						</Button>
						<Button disabled={activeMenuItems.length === 0} onClick={() => setCreating(true)}>
							<MessageSquarePlus className="size-4" />
							新增评价
						</Button>
					</ActionGroup>
				}
				description="查看学生评价，录入普通评价，并处理内容修改和隐藏状态。"
				title="评价维护"
			/>

			<form
				className="ops-filter-bar mb-4 grid grid-cols-2 items-end gap-3 xl:grid-cols-[10rem_9rem_minmax(12rem,1fr)_minmax(12rem,18rem)_auto]"
				onSubmit={(event) => {
					event.preventDefault();
					changeFilters({
						q: queryInput.trim() || undefined,
						submission_id: submissionInput.trim() || undefined,
					});
				}}
			>
				<Field label="评价目标">
					<FilterSelect
						id="review-target"
						value={targetType}
						onValueChange={(nextValue) => {
							changeFilters({
								targetType: (nextValue as "menu_item" | "submission") || undefined,
								menuItemId: undefined,
								submission_id: undefined,
							});
							setSubmissionInput("");
						}}
						options={[
							{ value: "", label: "全部目标" },
							{ value: "menu_item", label: "正式菜品" },
							{ value: "submission", label: "用户投稿" },
						]}
					/>
				</Field>
				<Field label="状态">
					<FilterSelect
						className="min-h-11"
						id="dining-review-visibility"
						onValueChange={(nextValue) => {
							changeFilters({ visibility: nextValue as ReviewVisibility });
						}}
						value={visibility}
						options={[
							{ value: "visible", label: "未隐藏" },
							{ value: "hidden", label: "已隐藏" },
							{ value: "deleted", label: "已删除" },
						]}
					/>
				</Field>
				{targetType === "submission" ? (
					<Field label="投稿标识" className="col-span-2 min-w-0 xl:col-span-1">
						<Input
							id="review-submission"
							value={submissionInput}
							onChange={(event) => {
								setSubmissionInput(event.target.value);
							}}
						/>
					</Field>
				) : null}
				<Field label="搜索" className="col-span-2 min-w-0 xl:col-span-1">
					<Input
						className="min-h-11"
						id="dining-review-query"
						maxLength={256}
						onChange={(event) => setQueryInput(event.target.value)}
						placeholder="评价内容、作者或菜品"
						value={queryInput}
					/>
				</Field>
				{targetType === "submission" ? null : (
					<Field label="菜品" className="min-w-0">
						<FilterSelect
							className="min-h-11"
							id="dining-review-menu-item"
							onValueChange={(nextValue) => {
								changeFilters({ menuItemId: nextValue || undefined });
							}}
							value={menuItemId}
							options={[
								{ value: "", label: "全部菜品" },
								...(menu.data?.items ?? []).map((item) => ({
									value: item.menuItemId,
									label: [item.name, item.archivedAt ? "（已归档）" : ""].join(""),
								})),
							]}
						/>
					</Field>
				)}

				<Button type="submit" variant="primary">
					<Search className="size-4" />
					搜索
				</Button>
			</form>

			{reviews.error || menu.error ? (
				<ErrorState
					error={reviews.error ?? menu.error}
					onRetry={() => void Promise.all([reviews.refetch(), menu.refetch()])}
					title="评价读取失败"
				/>
			) : null}
			{reviews.data ? (
				reviews.data.items.length === 0 ? (
					<StateMessage layout="inline" description="当前范围没有评价。" />
				) : (
					<ReviewList
						items={reviews.data.items}
						windowLabels={windowLabels}
						renderActions={renderActions}
					/>
				)
			) : reviews.error ? null : (
				<StateMessage role="status" description="正在读取评价..." />
			)}

			<ActionGroup className="mt-4 justify-end">
				<Button
					disabled={previousCursors.length === 0 || reviews.isFetching}
					onClick={() => {
						const previous = [...previousCursors];
						void navigate({
							search: {
								...search,
								cursor: previous.pop() || undefined,
								history: encodeCursorHistory(previous),
								reviewId: undefined,
							},
						});
					}}
					variant="ghost"
				>
					上一页
				</Button>
				<Button
					disabled={!reviews.data?.nextCursor || reviews.isFetching}
					onClick={() => {
						void navigate({
							search: {
								...search,
								cursor: reviews.data?.nextCursor ?? undefined,
								history: encodeCursorHistory([...previousCursors, cursor ?? ""]),
								reviewId: undefined,
							},
						});
					}}
					variant="ghost"
				>
					下一页
				</Button>
			</ActionGroup>

			{creating ? (
				<CreateReviewDialog
					items={activeMenuItems}
					onClose={() => setCreating(false)}
					onSaved={() => queryClient.invalidateQueries({ queryKey: ["dining", "reviews"] })}
				/>
			) : null}
			{detailReviewId ? (
				<ReviewDetailDialog
					key={detailReviewId}
					onClose={() => setDetailReviewId(null)}
					reviewId={detailReviewId}
				/>
			) : null}
		</section>
	);
}

function ReviewList({
	items,
	windowLabels,
	renderActions,
}: {
	items: DiningOpsContentReviewRecord[];
	windowLabels: Map<string, string>;
	renderActions: (review: DiningOpsContentReviewRecord) => ReactNode;
}) {
	return (
		<div
			className="divide-y divide-border rounded-lg border border-border bg-background px-4"
			data-testid="dining-reviews-list"
		>
			{items.map((review) => (
				<article className="grid min-w-0 gap-3 py-4" key={review.reviewId}>
					<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
						{reviewStatusBadge(review)}
						<span>
							{review.authorDisplayName ?? "身份已清理"} · {review.anonymous ? "匿名" : "署名"}
						</span>
						<time>{formatTimestamp(review.createdAt)}</time>
						{review.editedAt ? <Badge tone="neutral">已编辑</Badge> : null}
						{review.authorKind === "operator" ? <Badge tone="neutral">运维录入</Badge> : null}
					</div>
					<p className="line-clamp-3 whitespace-pre-wrap break-words text-sm text-foreground">
						{review.body ?? "正文已到期或清理"}
					</p>
					<div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
						<div className="min-w-0 text-xs text-muted-foreground">
							<p className="line-clamp-2 break-words font-medium text-foreground">
								{reviewTargetName(review)}
							</p>
							<p className="mt-1 break-words">
								{windowLabels.get(review.windowId ?? "") ?? review.windowId ?? "未关联窗口"}
							</p>
						</div>
						{renderActions(review)}
					</div>
				</article>
			))}
		</div>
	);
}

function CreateReviewDialog(props: {
	items: DiningMenuItemRecord[];
	onClose: () => void;
	onSaved: () => Promise<unknown>;
}) {
	const [menuItemId, setMenuItemId] = useState(props.items[0]?.menuItemId ?? "");
	const [body, setBody] = useState("");
	const [anonymous, setAnonymous] = useState(false);
	const idempotencyKey = useRef(crypto.randomUUID());
	const create = useMutation({
		mutationFn: () =>
			createDiningReview({
				anonymous,
				body: body.trim(),
				idempotencyKey: idempotencyKey.current,
				menuItemId,
			}),
		onSuccess: async () => {
			await props.onSaved();
			props.onClose();
		},
	});
	return (
		<Dialog onOpenChange={(open) => !open && props.onClose()} open>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>新增评价</DialogTitle>
					<DialogDescription>以普通评价形式立即发布到学生端。</DialogDescription>
				</DialogHeader>
				<form
					className="grid gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						create.mutate();
					}}
				>
					<Field label="菜品">
						<FilterSelect
							className="min-h-11"
							id="ops-review-menu-item"
							onValueChange={(nextValue) => setMenuItemId(nextValue)}
							required
							value={menuItemId}
							options={props.items.map((item) => ({
								value: item.menuItemId,
								label: item.name,
							}))}
						/>
					</Field>
					<Field
						label={
							<>
								<span className="font-medium text-foreground">评价正文</span>{" "}
								<span className="text-right text-muted-foreground text-xs">{body.length}/500</span>
							</>
						}
					>
						<Textarea
							className="min-h-32"
							id="ops-review-body"
							maxLength={500}
							onChange={(event) => setBody(event.target.value)}
							required
							value={body}
						/>
					</Field>
					<Label
						className="flex min-h-11 items-center gap-2 text-sm"
						htmlFor="ops-review-anonymous"
					>
						<Checkbox
							checked={anonymous}
							id="ops-review-anonymous"
							onCheckedChange={(checked) => setAnonymous(checked === true)}
						/>
						在学生端匿名显示
					</Label>
					{create.error ? <InlineError error={create.error} title="评价发布失败" /> : null}
					<DialogFooter>
						<Button onClick={props.onClose} variant="secondary">
							取消
						</Button>
						<Button disabled={create.isPending || !body.trim() || !menuItemId} type="submit">
							{create.isPending ? "发布中" : "发布"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function ReviewDetailDialog(props: { onClose: () => void; reviewId: string }) {
	const queryClient = useQueryClient();
	const [body, setBody] = useState("");
	const detail = useQuery({
		queryFn: ({ signal }) => fetchDiningReview(props.reviewId, { signal }),
		queryKey: ["dining", "review", props.reviewId],
	});
	useEffect(() => {
		if (detail.data) {
			setBody(detail.data.review.body ?? "");
		}
	}, [detail.data]);
	const update = useMutation({
		mutationFn: () => updateDiningReview(props.reviewId, body.trim()),
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["dining", "review", props.reviewId] }),
				queryClient.invalidateQueries({ queryKey: ["dining", "reviews"] }),
			]);
		},
	});
	return (
		<Dialog onOpenChange={(open) => !open && props.onClose()} open>
			<DialogContent className="w-[calc(100vw-2rem)] max-w-2xl" closeLabel="关闭评价详情">
				<DialogHeader>
					<DialogTitle>评价详情</DialogTitle>
					<DialogDescription>{props.reviewId}</DialogDescription>
				</DialogHeader>
				{detail.isPending ? (
					<StateMessage layout="inline" description="正在读取评价..." />
				) : detail.error || !detail.data ? (
					<ErrorState
						error={detail.error}
						onRetry={() => void detail.refetch()}
						title="评价读取失败"
					/>
				) : (
					<div className="grid gap-5">
						<div className="grid gap-1 border-border border-y py-3 text-sm sm:grid-cols-2">
							<p>
								<span className="text-muted-foreground">菜品：</span>
								{reviewTargetName(detail.data.review)}
							</p>
							<p>
								<span className="text-muted-foreground">作者：</span>
								{detail.data.review.authorDisplayName ?? "身份已清理"}
							</p>
							<p>
								<span className="text-muted-foreground">公开身份：</span>
								{detail.data.review.anonymous ? "匿名" : "署名"}
							</p>
							<p>
								<span className="text-muted-foreground">提交时间：</span>
								{formatTimestamp(detail.data.review.createdAt)}
							</p>
						</div>
						<Field
							label={
								<>
									<span className="font-medium text-foreground">评价正文</span>{" "}
									<span className="text-right text-muted-foreground text-xs">
										{body.length}/500
									</span>
								</>
							}
						>
							<Textarea
								className="min-h-36"
								disabled={Boolean(detail.data.review.deletedAt) || detail.data.review.body === null}
								id="ops-review-edit-body"
								maxLength={500}
								onChange={(event) => setBody(event.target.value)}
								value={body}
							/>
						</Field>
						{update.error ? <InlineError error={update.error} title="评价修改失败" /> : null}
						<div>
							<h3 className="mb-2 font-semibold text-sm">修改记录</h3>
							{detail.data.edits.length === 0 ? (
								<StateMessage description={<>尚无修改记录。</>} />
							) : (
								<ol className="grid max-h-56 gap-3 overflow-y-auto">
									{detail.data.edits.map((edit) => (
										<li className="rounded-md border border-border p-3 text-sm" key={edit.editId}>
											<p className="text-muted-foreground text-xs">
												{formatTimestamp(edit.editedAt)} · {edit.editedBy}
											</p>
											<p className="mt-2 whitespace-pre-wrap text-muted-foreground line-through">
												{edit.replayable ? edit.previousBody : "历史正文不可回放"}
											</p>
											<p className="mt-2 whitespace-pre-wrap text-foreground">
												{edit.replayable ? edit.nextBody : null}
											</p>
										</li>
									))}
								</ol>
							)}
						</div>
						<DialogFooter>
							<Button onClick={props.onClose} variant="secondary">
								关闭
							</Button>
							<Button
								disabled={
									update.isPending ||
									Boolean(detail.data.review.deletedAt) ||
									detail.data.review.body === null ||
									!body.trim() ||
									body.trim() === detail.data.review.body
								}
								onClick={() => update.mutate()}
							>
								{update.isPending ? "保存中" : "保存修改"}
							</Button>
						</DialogFooter>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}

function reviewStatusBadge(review: DiningOpsContentReviewRecord) {
	if (review.deletedAt) {
		return <Badge tone="neutral">已删除</Badge>;
	}
	if (review.hiddenAt) {
		return <Badge tone="warning">已隐藏</Badge>;
	}
	return <Badge tone="success">未隐藏</Badge>;
}

function reviewTargetName(review: DiningOpsContentReviewRecord) {
	return review.targetKind === "menu_item"
		? review.menuItemName
		: `用户投稿：${review.submissionName ?? "正文已清理"}`;
}
