import type { DiningMapDraft } from "@campus-agent/dining/domain";
import type { DiningFloorplanBundleV1 } from "@campus-agent/dining/floorplans";
import {
	Badge,
	Button,
	Card,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { History, RefreshCw, RotateCcw, Send } from "lucide-react";
import { lazy, Suspense, useCallback, useState } from "react";
import type { DiningReleaseSummary } from "../shared/dining-contract";
import { DiningTaskNavigation } from "./dining-navigation";
import {
	fetchDiningReleases,
	fetchDiningState,
	publishDiningDraft,
	restoreDiningRelease,
	saveDiningDraft,
} from "./ops-api/dining";
import { ConfirmAction } from "./ui/alert-dialog";
import "./dining-page.css";

const loadDiningFloorplanEditor = () =>
	import("./dining-studio/editor").then((module) => ({
		default: module.DiningFloorplanEditor,
	}));
const DiningFloorplanEditor = lazy(loadDiningFloorplanEditor);

export function DiningPage() {
	const queryClient = useQueryClient();
	const [unsavedCount, setUnsavedCount] = useState(0);
	const [navigationWarningOpen, setNavigationWarningOpen] = useState(false);
	const state = useQuery({
		queryKey: ["dining", "state"],
		queryFn: ({ signal }) => fetchDiningState({ signal }),
	});
	const releases = useQuery({
		queryKey: ["dining", "releases"],
		queryFn: ({ signal }) => fetchDiningReleases({ signal }),
	});
	const refresh = useCallback(async () => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: ["dining", "state"] }),
			queryClient.invalidateQueries({ queryKey: ["dining", "releases"] }),
		]);
	}, [queryClient]);
	const save = useMutation({
		mutationFn: (input: { bundle: DiningFloorplanBundleV1; expectedRevision: number }) =>
			saveDiningDraft(input),
		onSuccess: (result) => {
			queryClient.setQueryData(["dining", "state"], (current: typeof state.data) =>
				current ? { ...current, draft: result.draft } : current,
			);
		},
	});
	const publish = useMutation({
		mutationFn: publishDiningDraft,
		onSuccess: refresh,
	});
	const restore = useMutation({
		mutationFn: restoreDiningRelease,
		onSuccess: async (result) => {
			queryClient.setQueryData(["dining", "state"], {
				currentRelease: result.release,
				draft: result.draft,
			});
			await queryClient.invalidateQueries({ queryKey: ["dining", "releases"] });
		},
	});
	const navigationBlocker = useBlocker({
		disabled: unsavedCount === 0,
		enableBeforeUnload: unsavedCount > 0,
		shouldBlockFn: () => true,
		withResolver: true,
	});

	if (!state.data && state.error) {
		return (
			<PageFailure
				error={state.error}
				onRetry={() => void Promise.all([state.refetch(), releases.refetch()])}
			/>
		);
	}
	if (!state.data) {
		return <DiningPageLoading />;
	}

	const draft = state.data.draft;
	const currentRelease = state.data.currentRelease;
	const hasUnpublishedChanges = currentRelease?.snapshotHash !== draft.fingerprint;
	const mutationError = save.error ?? publish.error ?? restore.error;

	return (
		<div className="dining-workspace mx-auto grid w-full min-w-0 max-w-[1600px] gap-5">
			<DiningTaskNavigation />
			<header className="flex flex-wrap items-end justify-between gap-4 border-border border-b pb-4">
				<div>
					<p className="text-muted-foreground text-sm">食堂</p>
					<h1 className="ui-page-title">平面图维护</h1>
				</div>
				<div className="flex flex-wrap items-center justify-end gap-2">
					<PublicationState
						currentRelease={currentRelease}
						draft={draft}
						unsavedCount={unsavedCount}
					/>
					<Button
						aria-label="刷新食堂地图"
						disabled={state.isFetching || unsavedCount > 0}
						onClick={() => void refresh()}
						size="icon"
						variant="outline"
					>
						<RefreshCw className={`size-4 ${state.isFetching ? "animate-spin" : ""}`} />
					</Button>
					<ConfirmAction
						confirmLabel="发布"
						description="当前已保存草稿会成为学生端使用的地图，并创建一个不可变版本。"
						onConfirm={() => publish.mutate(draft.revision)}
						title="发布当前地图？"
						trigger={
							<Button
								disabled={
									unsavedCount > 0 || !hasUnpublishedChanges || publish.isPending || save.isPending
								}
							>
								<Send className="size-4" />
								发布
							</Button>
						}
					/>
				</div>
			</header>

			{mutationError ? (
				<div
					className="border-danger/20 border-y bg-danger-subtle px-4 py-3 text-danger text-sm"
					role="alert"
				>
					{errorMessage(mutationError)}
				</div>
			) : null}

			<div className="dining-workspace-columns min-w-0">
				<div className="dining-editor-container">
					<Suspense fallback={<EditorLoading />}>
						<DiningFloorplanEditor
							draft={draft}
							onSave={async (bundle, expectedRevision) => {
								const result = await save.mutateAsync({ bundle, expectedRevision });
								return result.draft;
							}}
							onUnsavedChange={setUnsavedCount}
							saving={save.isPending}
						/>
					</Suspense>
				</div>
				<ReleaseHistory
					currentReleaseId={releases.data?.currentReleaseId ?? currentRelease?.releaseId ?? null}
					draftRevision={draft.revision}
					error={releases.error}
					loading={releases.isLoading}
					onRestore={(releaseId) => restore.mutate({ expectedRevision: draft.revision, releaseId })}
					onRetry={() => void releases.refetch()}
					restoring={restore.isPending}
					releases={releases.data?.releases ?? []}
					unsavedCount={unsavedCount}
				/>
			</div>

			<Dialog
				onOpenChange={(open) => {
					setNavigationWarningOpen(open);
					if (!open && navigationBlocker.status === "blocked") {
						navigationBlocker.reset();
					}
				}}
				open={navigationWarningOpen || navigationBlocker.status === "blocked"}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>放弃未保存的地图修改？</DialogTitle>
						<DialogDescription>离开页面会丢失当前画布中尚未保存的修改。</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							onClick={() => {
								setNavigationWarningOpen(false);
								if (navigationBlocker.status === "blocked") {
									navigationBlocker.reset();
								}
							}}
							variant="outline"
						>
							继续编辑
						</Button>
						<Button
							onClick={() => {
								setNavigationWarningOpen(false);
								if (navigationBlocker.status === "blocked") {
									navigationBlocker.proceed();
								}
							}}
							variant="destructive"
						>
							放弃并离开
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function PublicationState(props: {
	currentRelease: DiningReleaseSummary | null;
	draft: DiningMapDraft;
	unsavedCount: number;
}) {
	if (props.unsavedCount > 0) {
		return <Badge tone="warning">{props.unsavedCount} 张地图未保存</Badge>;
	}
	if (!props.currentRelease) {
		return <Badge tone="neutral">尚未发布</Badge>;
	}
	return props.currentRelease.snapshotHash === props.draft.fingerprint ? (
		<Badge tone="success">学生端已更新</Badge>
	) : (
		<Badge tone="warning">草稿待发布</Badge>
	);
}

function ReleaseHistory(props: {
	currentReleaseId: string | null;
	draftRevision: number;
	error: unknown;
	loading: boolean;
	onRestore: (releaseId: string) => void;
	onRetry: () => void;
	releases: DiningReleaseSummary[];
	restoring: boolean;
	unsavedCount: number;
}) {
	return (
		<aside aria-labelledby="dining-release-history" className="dining-release-history min-w-0">
			<div className="mb-3 flex items-center gap-2">
				<History className="size-4 text-muted-foreground" />
				<h2 className="font-semibold" id="dining-release-history">
					发布历史
				</h2>
			</div>
			{props.loading ? (
				<div aria-label="正在读取发布历史" className="grid gap-2" role="status">
					{[0, 1, 2].map((item) => (
						<div className="h-20 animate-pulse rounded-md bg-surface-muted" key={item} />
					))}
				</div>
			) : props.error ? (
				<div
					className="border-danger/20 border-y bg-danger-subtle px-3 py-3 text-danger text-sm"
					role="alert"
				>
					<p>{errorMessage(props.error)}</p>
					<Button className="mt-3" onClick={props.onRetry} variant="outline">
						重试
					</Button>
				</div>
			) : props.releases.length === 0 ? (
				<p className="border-border border-y py-4 text-muted-foreground text-sm">尚无发布版本。</p>
			) : (
				<ol className="grid max-h-[690px] gap-2 overflow-y-auto pr-1">
					{props.releases.map((release) => {
						const current = release.releaseId === props.currentReleaseId;
						return (
							<li
								className="rounded-md border border-border bg-background p-3"
								key={release.releaseId}
							>
								<div className="flex items-start justify-between gap-2">
									<div className="min-w-0">
										<p className="font-medium text-sm">{formatReleaseKind(release)}</p>
										<p className="mt-1 text-muted-foreground text-xs">
											{formatDateTime(release.createdAt)}
										</p>
									</div>
									{current ? <Badge tone="success">当前</Badge> : null}
								</div>
								<p
									className="mt-2 truncate font-mono text-muted-foreground text-xs"
									title={release.releaseId}
								>
									{release.releaseId}
								</p>
								{current ? null : (
									<ConfirmAction
										confirmLabel="恢复"
										description="该版本会成为新的地图草稿和学生端版本，并保留现有发布历史。"
										onConfirm={() => props.onRestore(release.releaseId)}
										title="恢复这个地图版本？"
										trigger={
											<Button
												className="mt-3 w-full"
												disabled={props.restoring || props.unsavedCount > 0}
												variant="outline"
											>
												<RotateCcw className="size-4" />
												恢复
											</Button>
										}
									/>
								)}
							</li>
						);
					})}
				</ol>
			)}
		</aside>
	);
}

function DiningPageLoading() {
	return (
		<div
			aria-busy="true"
			aria-label="正在读取食堂地图"
			className="dining-workspace mx-auto grid w-full min-w-0 max-w-[1600px] gap-5"
			role="status"
		>
			<div className="h-16 animate-pulse border-border border-b bg-surface-muted" />
			<div className="dining-workspace-columns">
				<div className="h-[620px] animate-pulse rounded-xl bg-surface-muted" />
				<div className="h-80 animate-pulse rounded-md bg-surface-muted" />
			</div>
		</div>
	);
}

function EditorLoading() {
	return (
		<div
			aria-label="正在加载地图编辑器"
			className="h-[620px] animate-pulse rounded-xl bg-surface-muted"
			role="status"
		/>
	);
}

function PageFailure(props: { error: unknown; onRetry: () => void }) {
	return (
		<Card className="mx-auto w-full max-w-2xl p-6">
			<h1 className="font-semibold text-lg">食堂地图读取失败</h1>
			<p className="mt-2 text-muted-foreground text-sm">{errorMessage(props.error)}</p>
			<Button className="mt-4" onClick={props.onRetry} variant="outline">
				<RefreshCw className="size-4" />
				重试
			</Button>
		</Card>
	);
}

function formatReleaseKind(release: DiningReleaseSummary): string {
	return release.kind === "restore"
		? `恢复草稿第 ${release.draftRevision} 版`
		: `发布草稿第 ${release.draftRevision} 版`;
}

function formatDateTime(value: string): string {
	return new Intl.DateTimeFormat("zh-CN", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value));
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "食堂地图请求失败，请重试。";
}
