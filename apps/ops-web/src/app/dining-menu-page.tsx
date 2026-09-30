import type { DiningMenuItemRecord } from "@campus-agent/dining/domain";
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
	Disclosure,
	DisclosureSummary,
	Field,
	Input,
	Label,
	StateMessage,
} from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowDown, ArrowUp, Pencil, Plus, RefreshCw, RotateCcw } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import {
	DiningTaskNavigation,
	type DiningWindowOption,
	diningWindowOptions,
} from "./dining-navigation";
import { formatTimestamp } from "./format";
import {
	createDiningMenuItem,
	fetchDiningMenuItems,
	fetchDiningState,
	moveDiningMenuItem,
	reorderDiningMenuItems,
	setDiningMenuItemArchived,
	updateDiningMenuItem,
} from "./ops-api/dining";
import { ErrorState, InlineError, PageHeader, PageShell } from "./ops-display";
import { FilterSelect } from "./ui/filter-select";
import { useConfirmCommand } from "./use-confirm-command";

export function DiningMenuPage() {
	const confirmCommand = useConfirmCommand();

	const queryClient = useQueryClient();
	const [selectedWindowId, setSelectedWindowId] = useState("");
	const [showArchived, setShowArchived] = useState(false);
	const [editing, setEditing] = useState<DiningMenuItemRecord | "new" | null>(null);
	const state = useQuery({
		queryFn: ({ signal }) => fetchDiningState({ signal }),
		queryKey: ["dining", "state"],
	});
	const menu = useQuery({
		queryFn: ({ signal }) => fetchDiningMenuItems({ signal }),
		queryKey: ["dining", "menu-items"],
	});
	const windows = useMemo(
		() => (state.data ? diningWindowOptions(state.data.draft.bundle) : []),
		[state.data],
	);
	const windowLabels = useMemo(
		() => new Map(windows.map((window) => [window.windowId, window.label])),
		[windows],
	);
	const save = useMutation({
		mutationFn: async (input: {
			current: DiningMenuItemRecord | null;
			name: string;
			priceText: string | null;
			windowId: string;
		}) => {
			if (!input.current) {
				return createDiningMenuItem({
					name: input.name,
					priceText: input.priceText,
					windowId: input.windowId,
				});
			}
			if (input.current.windowId !== input.windowId) {
				await moveDiningMenuItem(input.current.menuItemId, input.windowId);
			}
			if (input.current.name !== input.name || input.current.priceText !== input.priceText) {
				return updateDiningMenuItem(input.current.menuItemId, {
					name: input.name,
					priceText: input.priceText,
				});
			}
			return null;
		},
		onSuccess: async () => {
			setEditing(null);
			await queryClient.invalidateQueries({ queryKey: ["dining", "menu-items"] });
		},
	});
	const archive = useMutation({
		mutationFn: (input: { archived: boolean; menuItemId: string }) =>
			setDiningMenuItemArchived(input.menuItemId, input.archived),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dining", "menu-items"] }),
	});
	const reorder = useMutation({
		mutationFn: (input: { menuItemIds: string[]; windowId: string }) =>
			reorderDiningMenuItems(input.windowId, input.menuItemIds),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dining", "menu-items"] }),
	});

	if (!(state.data && menu.data)) {
		return (
			<div className="mx-auto w-full max-w-[1600px]">
				<DiningTaskNavigation />
				{state.error || menu.error ? (
					<>
						<PageHeader title="菜单维护" />
						<ErrorState
							error={state.error ?? menu.error}
							onRetry={() => void Promise.all([state.refetch(), menu.refetch()])}
							title="菜单读取失败"
						/>
					</>
				) : (
					<PageShell title="菜单维护">正在读取窗口和菜单...</PageShell>
				)}
			</div>
		);
	}

	const items = menu.data.items.filter(
		(item) =>
			(!selectedWindowId || item.windowId === selectedWindowId) &&
			(showArchived || item.archivedAt === null),
	);
	const orderedItems = selectedWindowId
		? menu.data.items.filter(
				(item) => item.windowId === selectedWindowId && item.archivedAt === null,
			)
		: [];
	const moveInOrder = (item: DiningMenuItemRecord, direction: -1 | 1) => {
		const index = orderedItems.findIndex((candidate) => candidate.menuItemId === item.menuItemId);
		const target = index + direction;
		if (index < 0 || target < 0 || target >= orderedItems.length) {
			return;
		}
		const ids = orderedItems.map((candidate) => candidate.menuItemId);
		const currentId = ids[index];
		const targetId = ids[target];
		if (!(currentId && targetId)) {
			return;
		}
		[ids[index], ids[target]] = [targetId, currentId];
		reorder.mutate({ menuItemIds: ids, windowId: selectedWindowId });
	};
	const mutationError = reorder.error;

	const renderActions = (item: DiningMenuItemRecord) => (
		<ActionGroup className="justify-start sm:justify-end">
			{selectedWindowId && !item.archivedAt ? (
				<>
					<Button
						aria-label={`上移 ${item.name}`}
						disabled={reorder.isPending || orderedItems[0]?.menuItemId === item.menuItemId}
						onClick={() => moveInOrder(item, -1)}
						size="sm"
						variant="ghost"
					>
						<ArrowUp className="size-4" />
						<span className="sr-only">上移</span>
					</Button>
					<Button
						aria-label={`下移 ${item.name}`}
						disabled={reorder.isPending || orderedItems.at(-1)?.menuItemId === item.menuItemId}
						onClick={() => moveInOrder(item, 1)}
						size="sm"
						variant="ghost"
					>
						<ArrowDown className="size-4" />
						<span className="sr-only">下移</span>
					</Button>
				</>
			) : null}
			<Button
				aria-label={`编辑 ${item.name}`}
				onClick={() => setEditing(item)}
				size="sm"
				variant="ghost"
			>
				<Pencil className="size-4" />
				编辑
			</Button>
			<ConfirmDialog
				confirmLabel={item.archivedAt ? "恢复" : "归档"}
				confirmVariant={item.archivedAt ? "primary" : "destructive"}
				description={
					item.archivedAt
						? "恢复后该菜品会随缓存更新重新出现在学生端菜单中。"
						: "归档后该菜品不再出现在学生端，已有评价仍会保留。"
				}
				{...confirmCommand(`${item.menuItemId}-actions`, () =>
					archive.mutateAsync({
						archived: !item.archivedAt,
						menuItemId: item.menuItemId,
					}),
				)}
				title={`${item.archivedAt ? "恢复" : "归档"}“${item.name}”？`}
				trigger={
					<Button
						aria-label={`${item.archivedAt ? "恢复" : "归档"} ${item.name}`}
						disabled={archive.isPending}
						size="sm"
						variant="ghost"
					>
						{item.archivedAt ? <RotateCcw className="size-4" /> : <Archive className="size-4" />}
						{item.archivedAt ? "恢复" : "归档"}
					</Button>
				}
			/>
		</ActionGroup>
	);

	return (
		<section className="mx-auto w-full max-w-[1600px]">
			<DiningTaskNavigation />
			<PageHeader
				actions={
					<ActionGroup>
						<Button
							aria-label="刷新菜单"
							disabled={state.isFetching || menu.isFetching}
							onClick={() => void Promise.all([state.refetch(), menu.refetch()])}
							size="icon"
							variant="ghost"
						>
							<RefreshCw className={`size-4 ${menu.isFetching ? "animate-spin" : ""}`} />
						</Button>
						<Button disabled={windows.length === 0} onClick={() => setEditing("new")}>
							<Plus className="size-4" />
							新增菜品
						</Button>
					</ActionGroup>
				}
				description="按地图窗口维护菜品和价格，保存后随学生端缓存更新生效。"
				title="菜单维护"
			/>

			<div className="ops-filter-bar mb-4 flex flex-wrap items-end gap-3">
				<Field label="窗口" className="w-full min-w-0 sm:max-w-md">
					<FilterSelect
						className="min-h-11 w-full min-w-0 max-w-full"
						id="dining-menu-window"
						onValueChange={(nextValue) => setSelectedWindowId(nextValue)}
						value={selectedWindowId}
						options={[
							{ value: "", label: "全部窗口" },
							...windows.map((window) => ({
								value: window.windowId,
								label: window.label,
							})),
						]}
					/>
				</Field>
				<Label
					className="flex min-h-11 items-center gap-2 text-sm"
					htmlFor="dining-menu-show-archived"
				>
					<Checkbox
						checked={showArchived}
						id="dining-menu-show-archived"
						onCheckedChange={(checked) => setShowArchived(checked === true)}
					/>
					显示已归档菜品
				</Label>
			</div>

			{mutationError ? (
				<div className="mb-4">
					<InlineError error={mutationError} title="菜单修改失败" />
				</div>
			) : null}

			{items.length === 0 ? (
				<StateMessage layout="inline" description="当前范围没有菜品。" />
			) : (
				<div className="space-y-6">
					{windows
						.filter((window) => items.some((item) => item.windowId === window.windowId))
						.map((window) => (
							<section
								key={window.windowId}
								aria-label={window.label}
								className="overflow-hidden rounded-lg border border-border bg-background"
							>
								<div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-4 py-3">
									<h2 className="min-w-0 break-words text-sm font-semibold">{window.label}</h2>
									{selectedWindowId ? null : (
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setSelectedWindowId(window.windowId)}
										>
											管理此窗口
										</Button>
									)}
								</div>
								<ul className="divide-y divide-border">
									{items
										.filter((item) => item.windowId === window.windowId)
										.map((item) => (
											<li
												key={item.menuItemId}
												className="grid min-w-0 gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
											>
												<div className="min-w-0">
													<div className="flex flex-wrap items-center gap-2">
														<h3 className="break-words font-medium">{item.name}</h3>
														{item.archivedAt ? <Badge tone="neutral">已归档</Badge> : null}
													</div>
													<p className="mt-1 break-words text-sm text-muted-foreground">
														{item.priceText ?? "未填写价格"}
													</p>
												</div>
												{renderActions(item)}
											</li>
										))}
								</ul>
							</section>
						))}
					{items.some((item) => !windowLabels.has(item.windowId)) ? (
						<section aria-label="未关联窗口" className="rounded-lg border border-border p-4">
							<h2 className="mb-3 text-sm font-semibold">未关联窗口</h2>
							<ul className="divide-y divide-border">
								{items
									.filter((item) => !windowLabels.has(item.windowId))
									.map((item) => (
										<li
											key={item.menuItemId}
											className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto]"
										>
											<div className="min-w-0">
												<h3 className="break-words font-medium">{item.name}</h3>
												<p className="break-words text-sm text-muted-foreground">
													{item.priceText ?? "未填写价格"}
												</p>
												<p className="break-all text-xs text-muted-foreground">{item.windowId}</p>
											</div>
											{renderActions(item)}
										</li>
									))}
							</ul>
						</section>
					) : null}
				</div>
			)}

			{editing ? (
				<MenuItemDialog
					item={editing === "new" ? null : editing}
					key={editing === "new" ? "new" : editing.menuItemId}
					onClose={() => {
						setEditing(null);
						save.reset();
					}}
					onSave={(value) => save.mutateAsync(value)}
					pending={save.isPending}
					saveError={save.error}
					selectedWindowId={selectedWindowId}
					windows={windows}
				/>
			) : null}
		</section>
	);
}

function MenuItemDialog(props: {
	item: DiningMenuItemRecord | null;
	onClose: () => void;
	onSave: (input: {
		current: DiningMenuItemRecord | null;
		name: string;
		priceText: string | null;
		windowId: string;
	}) => Promise<unknown>;
	pending: boolean;
	saveError: unknown;
	selectedWindowId: string;
	windows: DiningWindowOption[];
}) {
	const [name, setName] = useState(props.item?.name ?? "");
	const [priceText, setPriceText] = useState(props.item?.priceText ?? "");
	const [windowId, setWindowId] = useState(
		props.item?.windowId || props.selectedWindowId || props.windows[0]?.windowId || "",
	);
	const submit = (event: FormEvent) => {
		event.preventDefault();
		void props
			.onSave({
				current: props.item,
				name: name.trim(),
				priceText: priceText.trim() || null,
				windowId,
			})
			.catch(() => undefined);
	};
	return (
		<Dialog onOpenChange={(open) => !open && props.onClose()} open>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{props.item ? "编辑菜品" : "新增菜品"}</DialogTitle>
					<DialogDescription>保存后学生端菜单会在缓存更新后生效。</DialogDescription>
				</DialogHeader>
				<form className="grid gap-4" onSubmit={submit}>
					<Field label="菜品名称">
						<Input
							className="min-h-11"
							id="menu-item-name"
							maxLength={80}
							onChange={(event) => setName(event.target.value)}
							required
							value={name}
						/>
					</Field>
					<Field label="价格">
						<Input
							className="min-h-11"
							id="menu-item-price"
							maxLength={40}
							onChange={(event) => setPriceText(event.target.value)}
							placeholder="可留空，例如 12 元"
							value={priceText}
						/>
					</Field>
					<Field label="窗口">
						<FilterSelect
							className="min-h-11"
							id="menu-item-window"
							onValueChange={(nextValue) => setWindowId(nextValue)}
							required
							value={windowId}
							options={props.windows.map((window) => ({
								value: window.windowId,
								label: window.label,
							}))}
						/>
					</Field>
					{props.item ? (
						<Disclosure>
							<DisclosureSummary>菜品信息</DisclosureSummary>
							<div className="space-y-2 py-3 text-xs text-muted-foreground">
								<p className="break-all">菜品标识：{props.item.menuItemId}</p>
								<p>最近修改：{formatTimestamp(props.item.updatedAt)}</p>
							</div>
						</Disclosure>
					) : null}
					{props.saveError ? <InlineError error={props.saveError} title="保存失败" /> : null}
					<DialogFooter>
						<Button onClick={props.onClose} type="button" variant="secondary">
							取消
						</Button>
						<Button disabled={props.pending || !name.trim() || !windowId} type="submit">
							{props.pending ? "保存中" : "保存"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
