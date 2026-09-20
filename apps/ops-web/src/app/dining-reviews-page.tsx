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
	Input,
	NativeSelect,
	Textarea,
} from "@campus-agent/ui";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, FileClock, MessageSquarePlus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DiningTaskNavigation } from "./dining-navigation";
import { formatTimestamp } from "./format";
import {
	createDiningReview,
	deleteDiningOperatorReview,
	fetchDiningMenuItems,
	fetchDiningReview,
	fetchDiningReviews,
	setDiningReviewVisible,
	updateDiningReview,
} from "./ops-api/dining";
import { ErrorState, InlineError, PageHeader, PageShell } from "./ops-display";
import { DataTable } from "./ui/data-table";
import { useConfirmCommand } from "./use-confirm-command";

type ReviewVisibility = "deleted" | "hidden" | "visible";

export function DiningReviewsPage({
	initialSubmissionId,
}: {
	initialSubmissionId?: string | undefined;
} = {}) {
	const confirmCommand = useConfirmCommand();

	const queryClient = useQueryClient();
	const [cursor, setCursor] = useState<string | undefined>();
	const [previousCursors, setPreviousCursors] = useState<Array<string | undefined>>([]);
	const [queryInput, setQueryInput] = useState("");
	const [query, setQuery] = useState("");
	const [menuItemId, setMenuItemId] = useState("");
	const [targetType, setTargetType] = useState<"menu_item" | "submission" | "">(
		initialSubmissionId ? "submission" : "",
	);
	const [submissionId, setSubmissionId] = useState(initialSubmissionId ?? "");
	const [visibility, setVisibility] = useState<ReviewVisibility>("visible");
	const [detailReviewId, setDetailReviewId] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);
	const menu = useQuery({
		queryFn: ({ signal }) => fetchDiningMenuItems({ signal }),
		queryKey: ["dining", "menu-items"],
	});
	const reviews = useQuery({
		placeholderData: keepPreviousData,
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
	const resetPage = () => {
		setCursor(undefined);
		setPreviousCursors([]);
	};

	if (!(reviews.data && menu.data)) {
		return (
			<div className="mx-auto w-full max-w-[1600px]">
				<DiningTaskNavigation />
				{reviews.error || menu.error ? (
					<ErrorState
						error={reviews.error ?? menu.error}
						onRetry={() => void Promise.all([reviews.refetch(), menu.refetch()])}
						title="评价读取失败"
					/>
				) : (
					<PageShell title="评价维护">正在读取评价...</PageShell>
				)}
			</div>
		);
	}

	const activeMenuItems = menu.data.items.filter((item) => item.archivedAt === null);
	const mutationError = visibilityMutation.error ?? deleteMutation.error;
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
							variant="outline"
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

			<div className="mb-3 grid gap-3 md:grid-cols-2">
				<label className="grid gap-1 text-sm" htmlFor="review-target">
					<span>评价目标</span>
					<NativeSelect
						id="review-target"
						value={targetType}
						onChange={(event) => {
							setTargetType(event.target.value as "menu_item" | "submission" | "");
							setMenuItemId("");
							setSubmissionId("");
							resetPage();
						}}
					>
						<option value="">全部目标</option>
						<option value="menu_item">正式菜品</option>
						<option value="submission">用户投稿</option>
					</NativeSelect>
				</label>
				{targetType === "submission" ? (
					<label className="grid gap-1 text-sm" htmlFor="review-submission">
						<span>投稿标识</span>
						<Input
							id="review-submission"
							value={submissionId}
							onChange={(event) => {
								setSubmissionId(event.target.value);
								resetPage();
							}}
						/>
					</label>
				) : null}
			</div>
			<form
				className="mb-4 grid gap-3 lg:grid-cols-[minmax(16rem,1fr)_minmax(14rem,22rem)_12rem_auto] lg:items-end"
				onSubmit={(event) => {
					event.preventDefault();
					setQuery(queryInput.trim());
					resetPage();
				}}
			>
				<label className="grid gap-1 text-sm" htmlFor="dining-review-query">
					<span className="font-medium text-foreground">搜索</span>
					<Input
						className="min-h-11"
						id="dining-review-query"
						maxLength={256}
						onChange={(event) => setQueryInput(event.target.value)}
						placeholder="评价内容、作者或菜品"
						value={queryInput}
					/>
				</label>
				<label className="grid gap-1 text-sm" htmlFor="dining-review-menu-item">
					<span className="font-medium text-foreground">菜品</span>
					<NativeSelect
						className="min-h-11"
						id="dining-review-menu-item"
						disabled={targetType === "submission"}
						onChange={(event) => {
							setMenuItemId(event.target.value);
							resetPage();
						}}
						value={menuItemId}
					>
						<option value="">全部菜品</option>
						{menu.data.items.map((item) => (
							<option key={item.menuItemId} value={item.menuItemId}>
								{item.name}
								{item.archivedAt ? "（已归档）" : ""}
							</option>
						))}
					</NativeSelect>
				</label>
				<label className="grid gap-1 text-sm" htmlFor="dining-review-visibility">
					<span className="font-medium text-foreground">状态</span>
					<NativeSelect
						className="min-h-11"
						id="dining-review-visibility"
						onChange={(event) => {
							setVisibility(event.target.value as ReviewVisibility);
							resetPage();
						}}
						value={visibility}
					>
						<option value="visible">未隐藏</option>
						<option value="hidden">已隐藏</option>
						<option value="deleted">已删除</option>
					</NativeSelect>
				</label>
				<Button type="submit" variant="outline">
					<Search className="size-4" />
					搜索
				</Button>
			</form>

			{mutationError ? (
				<div className="mb-4">
					<InlineError error={mutationError} title="评价操作失败" />
				</div>
			) : null}

			{reviews.data.items.length === 0 ? (
				<div className="border-border border-y py-10 text-center text-muted-foreground text-sm">
					当前范围没有评价。
				</div>
			) : (
				<DataTable
					caption="评价列表"
					columns={[
						{
							cell: (review) => (
								<div className="max-w-xl">
									<p className="line-clamp-3 whitespace-pre-wrap text-foreground">
										{review.body ?? "正文已到期或清理"}
									</p>
									<div className="mt-2 flex flex-wrap gap-2">
										{review.editedAt ? <Badge tone="neutral">已编辑</Badge> : null}
										{review.authorKind === "operator" ? (
											<Badge tone="neutral">运维录入</Badge>
										) : null}
									</div>
								</div>
							),
							header: "评价",
							rowHeader: true,
						},
						{
							cell: (review) => (
								<div>
									<p className="font-medium">{reviewTargetName(review)}</p>
									<p className="mt-1 font-mono text-muted-foreground text-xs">{review.windowId}</p>
								</div>
							),
							header: "菜品 / 窗口",
						},
						{
							cell: (review) => (
								<div>
									<p>{review.authorDisplayName ?? "身份已清理"}</p>
									<p className="mt-1 text-muted-foreground text-xs">
										{review.anonymous ? "公开匿名" : "公开署名"}
									</p>
								</div>
							),
							header: "作者",
						},
						{ cell: reviewStatusBadge, header: "状态" },
						{ cell: (review) => formatTimestamp(review.createdAt), header: "提交时间" },
						{
							cell: (review) => (
								<ActionGroup className="justify-end">
									<Button
										aria-label={`查看评价 ${review.reviewId}`}
										onClick={() => setDetailReviewId(review.reviewId)}
										size="icon"
										variant="ghost"
									>
										<FileClock className="size-4" />
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
											size="icon"
											variant="ghost"
										>
											{review.hiddenAt ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
										</Button>
									)}
									{review.authorKind === "operator" && !review.deletedAt ? (
										<ConfirmDialog
											confirmLabel="删除"
											description="评价会从学生端移除并保留数据库记录，删除后不能编辑。"
											{...confirmCommand(review.reviewId, () =>
												deleteMutation.mutateAsync(review.reviewId),
											)}
											title="删除这条运维录入评价？"
											trigger={
												<Button
													aria-label={`删除评价 ${review.reviewId}`}
													disabled={deleteMutation.isPending}
													size="icon"
													variant="ghost"
												>
													<Trash2 className="size-4" />
												</Button>
											}
										/>
									) : null}
								</ActionGroup>
							),
							header: "操作",
						},
					]}
					data={reviews.data.items}
					minWidth="1180px"
					rowKey={(review) => review.reviewId}
					stickyFirstColumn
					stickyLastColumn
				/>
			)}

			<ActionGroup className="mt-4 justify-end">
				<Button
					disabled={previousCursors.length === 0 || reviews.isFetching}
					onClick={() => {
						const previous = [...previousCursors];
						setCursor(previous.pop());
						setPreviousCursors(previous);
					}}
					variant="outline"
				>
					上一页
				</Button>
				<Button
					disabled={!reviews.data.nextCursor || reviews.isFetching}
					onClick={() => {
						setPreviousCursors((values) => [...values, cursor]);
						setCursor(reviews.data?.nextCursor ?? undefined);
					}}
					variant="outline"
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
					<label className="grid gap-1 text-sm" htmlFor="ops-review-menu-item">
						<span className="font-medium text-foreground">菜品</span>
						<NativeSelect
							className="min-h-11"
							id="ops-review-menu-item"
							onChange={(event) => setMenuItemId(event.target.value)}
							required
							value={menuItemId}
						>
							{props.items.map((item) => (
								<option key={item.menuItemId} value={item.menuItemId}>
									{item.name}
								</option>
							))}
						</NativeSelect>
					</label>
					<label className="grid gap-1 text-sm" htmlFor="ops-review-body">
						<span className="font-medium text-foreground">评价正文</span>
						<Textarea
							className="min-h-32"
							id="ops-review-body"
							maxLength={500}
							onChange={(event) => setBody(event.target.value)}
							required
							value={body}
						/>
						<span className="text-right text-muted-foreground text-xs">{body.length}/500</span>
					</label>
					<label
						className="flex min-h-11 items-center gap-2 text-sm"
						htmlFor="ops-review-anonymous"
					>
						<Checkbox
							checked={anonymous}
							id="ops-review-anonymous"
							onCheckedChange={(checked) => setAnonymous(checked === true)}
						/>
						在学生端匿名显示
					</label>
					{create.error ? <InlineError error={create.error} title="评价发布失败" /> : null}
					<DialogFooter>
						<Button onClick={props.onClose} variant="outline">
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
			<DialogContent className="w-[min(44rem,calc(100vw-2rem))]" closeLabel="关闭评价详情">
				<DialogHeader>
					<DialogTitle>评价详情</DialogTitle>
					<DialogDescription>{props.reviewId}</DialogDescription>
				</DialogHeader>
				{detail.isPending ? (
					<p className="py-6 text-muted-foreground text-sm">正在读取评价...</p>
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
						<label className="grid gap-1 text-sm" htmlFor="ops-review-edit-body">
							<span className="font-medium text-foreground">评价正文</span>
							<Textarea
								className="min-h-36"
								disabled={Boolean(detail.data.review.deletedAt) || detail.data.review.body === null}
								id="ops-review-edit-body"
								maxLength={500}
								onChange={(event) => setBody(event.target.value)}
								value={body}
							/>
							<span className="text-right text-muted-foreground text-xs">{body.length}/500</span>
						</label>
						{update.error ? <InlineError error={update.error} title="评价修改失败" /> : null}
						<div>
							<h3 className="mb-2 font-semibold text-sm">修改记录</h3>
							{detail.data.edits.length === 0 ? (
								<p className="border-border border-y py-3 text-muted-foreground text-sm">
									尚无修改记录。
								</p>
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
							<Button onClick={props.onClose} variant="outline">
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
