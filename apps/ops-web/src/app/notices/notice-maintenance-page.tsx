import {
	ActionGroup,
	Button,
	cn,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
	Sheet,
	SheetContent,
} from "@campus-agent/ui";
import { RefreshCw, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ErrorState, PageHeader, StaleDataWarning } from "../ops-display";
import { NoticeInspector } from "./notice-inspector";
import { NoticeMaintenanceToolbar } from "./notice-maintenance-toolbar";
import { NoticeQueue } from "./notice-queue";
import { NoticeTaskCenter } from "./notice-task-center";
import { useNoticeMaintenance } from "./use-notice-maintenance";

export function NoticeMaintenancePage() {
	const model = useNoticeMaintenance();
	const desktop = useDesktopLayout();
	const inspector = useRef<HTMLElement>(null);
	useLayoutEffect(() => {
		const element = inspector.current;
		if (!(desktop && model.selectedNoticeId && element)) {
			return;
		}
		const resize = () => {
			const height = Math.max(0, window.innerHeight - element.getBoundingClientRect().top - 16);
			element.style.height = `${height}px`;
		};
		resize();
		window.addEventListener("scroll", resize, { passive: true });
		window.addEventListener("resize", resize);
		const observer = new ResizeObserver(resize);
		if (element.parentElement) {
			observer.observe(element.parentElement);
		}
		return () => {
			window.removeEventListener("scroll", resize);
			window.removeEventListener("resize", resize);
			observer.disconnect();
		};
	}, [desktop, model.selectedNoticeId]);
	const returnFocus = useRef<HTMLElement | null>(null);
	useEffect(() => {
		if (desktop && model.selectedNoticeId === null && returnFocus.current?.isConnected) {
			returnFocus.current.focus({ preventScroll: true });
		}
	}, [desktop, model.selectedNoticeId]);
	const routeBlocked = model.blocker.status === "blocked";
	const unsavedDialogOpen = Boolean(model.pendingIntent) || routeBlocked;

	const cancelUnsaved = () => {
		if (model.pendingIntent) {
			model.cancelPendingIntent();
			return;
		}
		if (routeBlocked) {
			model.cancelRouteLeave();
		}
	};

	const discardUnsaved = () => {
		if (model.pendingIntent) {
			model.discardPendingIntent();
			return;
		}
		if (routeBlocked) {
			model.discardRouteChanges();
		}
	};

	const saveUnsaved = () => {
		if (model.pendingIntent) {
			void model.saveAndContinue();
			return;
		}
		if (routeBlocked) {
			void model.saveAndLeave();
		}
	};

	return (
		<section className="min-w-0">
			<PageHeader
				actions={
					<ActionGroup>
						<Button onClick={() => model.setTaskCenterOpen(true)} variant="secondary">
							任务中心
							{model.activeJobCount > 0 ? (
								<span className="font-mono text-xs">（{model.activeJobCount}）</span>
							) : null}
						</Button>
						<Button
							aria-label="刷新通知队列"
							disabled={model.notices.isFetching}
							onClick={() => void model.notices.refetch()}
							variant="ghost"
						>
							<RefreshCw className={model.notices.isFetching ? "size-4 animate-spin" : "size-4"} />
							刷新
						</Button>
					</ActionGroup>
				}
				description="从同一条通知记录完成分类维护，并按状态处理发布任务。"
				title="通知维护"
			/>

			<NoticeMaintenanceToolbar
				category={model.category}
				counts={model.notices.data?.counts ?? null}
				isFetching={model.notices.isFetching}
				isPlaceholderData={model.notices.isPlaceholderData}
				onCategoryChange={(next) => model.requestFilters({ category: next, page: 1 })}
				onSearch={model.requestSearch}
				onSearchChange={model.setSearch}
				onStateChange={(next) => model.requestFilters({ state: next, page: 1 })}
				q={model.q}
				search={model.search}
				state={model.state}
			/>

			<div className="mb-4 flex flex-wrap gap-x-4 gap-y-2  text-sm">
				<a href="/tasks" className="underline">
					查看定时任务与调度设置
				</a>
				<a href="/notices?issueStage=classification" className="underline">
					分类问题
				</a>
				<a href="/notices?issueStage=publication" className="underline">
					发布问题
				</a>
				<a href="/notices" className="underline">
					全部通知
				</a>
			</div>

			{model.notices.isError && model.notices.data ? (
				<StaleDataWarning
					error={model.notices.error}
					lastSuccessfulAt={model.notices.dataUpdatedAt}
					onRetry={() => void model.notices.refetch()}
					title="通知队列刷新失败"
				/>
			) : null}
			{model.notices.isError && !model.notices.data ? (
				<ErrorState
					error={model.notices.error}
					onRetry={() => void model.notices.refetch()}
					title="通知读取失败"
				/>
			) : null}

			<div
				className={cn(
					"grid min-w-0 gap-5",
					model.selectedNoticeId && "lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]",
				)}
			>
				<NoticeQueue
					data={model.notices.data}
					isFetching={model.notices.isFetching}
					isPending={model.notices.isPending}
					isPlaceholderData={model.notices.isPlaceholderData}
					onPage={model.requestPage}
					onSelect={(id) => {
						returnFocus.current =
							document.activeElement instanceof HTMLElement ? document.activeElement : null;
						model.requestSelectNotice(id);
					}}
					selectedNoticeId={model.selectedNoticeId}
				/>
				{desktop && model.selectedNoticeId ? (
					<aside
						ref={inspector}
						aria-label="通知检查器"
						className="sticky top-[var(--ops-sticky-top)] flex min-h-0 min-w-0 flex-col self-start overflow-hidden rounded-[var(--card-radius)] border border-border bg-card"
					>
						<div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-1">
							<p className="text-xs font-medium text-muted-foreground">通知详情</p>
							<Button
								aria-label="收起通知详情"
								size="icon"
								variant="ghost"
								onClick={() => model.requestCloseNotice()}
							>
								<X className="size-4" />
							</Button>
						</div>
						<NoticeInspector
							createJobError={model.createJobError}
							currentNoticeJobs={model.currentNoticeJobs}
							currentPendingJobSubmissions={model.currentPendingJobSubmissions}
							detailError={model.detail.error}
							detailPending={model.detail.isPending}
							dirty={model.dirty}
							draftCategory={model.draftCategory}
							isFamilyBusy={model.isFamilyBusy}
							notice={model.selectedNotice}
							onDraftCategory={model.setDraftCategory}
							onRetry={() => void model.detail.refetch()}
							onSave={() => void model.saveDraft().catch(() => undefined)}
							onStartJob={model.startJob}
							saveError={model.saveCategoryError}
							savePending={model.saveCategoryPending}
							saveSucceeded={model.saveCategorySucceeded}
							selectedNoticeId={model.selectedNoticeId}
						/>
					</aside>
				) : null}
			</div>

			{desktop ? null : (
				<Sheet
					onOpenChange={(open) => {
						if (!open) {
							model.requestCloseNotice();
						}
					}}
					open={model.selectedNoticeId !== null}
				>
					<SheetContent
						aria-label="通知详情"
						onOpenAutoFocus={() => {
							returnFocus.current =
								document.activeElement instanceof HTMLElement ? document.activeElement : null;
						}}
						onCloseAutoFocus={(event) => {
							event.preventDefault();
							returnFocus.current?.focus();
						}}
						className="flex w-full max-w-none flex-col p-0"
						side="right"
					>
						<NoticeInspector
							createJobError={model.createJobError}
							currentNoticeJobs={model.currentNoticeJobs}
							currentPendingJobSubmissions={model.currentPendingJobSubmissions}
							detailError={model.detail.error}
							detailPending={model.detail.isPending}
							dirty={model.dirty}
							draftCategory={model.draftCategory}
							isFamilyBusy={model.isFamilyBusy}
							mobile
							notice={model.selectedNotice}
							onDraftCategory={model.setDraftCategory}
							onRetry={() => void model.detail.refetch()}
							onSave={() => void model.saveDraft().catch(() => undefined)}
							onStartJob={model.startJob}
							saveError={model.saveCategoryError}
							savePending={model.saveCategoryPending}
							saveSucceeded={model.saveCategorySucceeded}
							selectedNoticeId={model.selectedNoticeId}
						/>
					</SheetContent>
				</Sheet>
			)}

			<NoticeTaskCenter
				createError={model.createJobError}
				isFamilyBusy={model.isFamilyBusy}
				jobs={model.jobs.data?.jobs ?? []}
				jobsError={model.jobs.error}
				onRetry={() => {
					void model.jobs.refetch();
				}}
				jobsPending={model.jobs.isPending}
				onCreate={model.startJob}
				onOpenChange={model.setTaskCenterOpen}
				open={model.taskCenterOpen}
				pendingSubmissions={model.pendingJobSubmissions}
			/>

			<Dialog
				onOpenChange={(open) => {
					if (!open) {
						cancelUnsaved();
					}
				}}
				open={unsavedDialogOpen}
			>
				<DialogContent className="max-w-md" showCloseButton={false}>
					<DialogTitle>有未保存的分类更改</DialogTitle>
					<DialogDescription>
						{routeBlocked
							? "离开当前页面会丢失尚未保存的分类更改。"
							: "切换通知或筛选会丢失尚未保存的分类更改。"}
					</DialogDescription>
					<DialogFooter>
						<Button autoFocus onClick={cancelUnsaved} variant="secondary">
							取消
						</Button>
						<Button onClick={discardUnsaved} variant="secondary">
							放弃更改
						</Button>
						<Button disabled={model.saveCategoryPending} onClick={saveUnsaved}>
							保存并继续
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}

function useDesktopLayout() {
	const [desktop, setDesktop] = useState(() => {
		if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
			return false;
		}
		return window.matchMedia("(min-width: 1024px)").matches;
	});

	useEffect(() => {
		if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
			return;
		}
		const media = window.matchMedia("(min-width: 1024px)");
		const update = (event: MediaQueryListEvent) => setDesktop(event.matches);
		setDesktop(media.matches);
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, []);

	return desktop;
}
