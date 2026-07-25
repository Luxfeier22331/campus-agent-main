import type { DiningMenuItemRecord } from "@campus-agent/dining/domain";
import {
	Badge,
	Button,
	Checkbox,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	NativeSelect,
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
} from "./ops-api-client";
import { ErrorState, InlineError, PageHeader, PageShell } from "./ops-display";
import { ConfirmAction } from "./ui/alert-dialog";
import { DataTable } from "./ui/data-table";

export function DiningMenuPage() {
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
					<ErrorState
						error={state.error ?? menu.error}
						onRetry={() => void Promise.all([state.refetch(), menu.refetch()])}
						title="菜单读取失败"
					/>
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
	const mutationError = save.error ?? archive.error ?? reorder.error;

	return (
		<section className="mx-auto w-full max-w-[1600px]">
			<DiningTaskNavigation />
			<PageHeader
				actions={
					<div className="flex flex-wrap gap-2">
						<Button
							aria-label="刷新菜单"
							disabled={state.isFetching || menu.isFetching}
							onClick={() => void Promise.all([state.refetch(), menu.refetch()])}
							size="icon"
							variant="outline"
						>
							<RefreshCw className={`size-4 ${menu.isFetching ? "animate-spin" : ""}`} />
						</Button>
						<Button disabled={windows.length === 0} onClick={() => setEditing("new")}>
							<Plus className="size-4" />
							新增菜品
						</Button>
					</div>
				}
				description="按地图窗口维护学生端立即可见的菜品和价格。"
				title="菜单维护"
			/>

			<div className="mb-4 flex flex-wrap items-end gap-3">
				<label
					className="grid w-full min-w-0 max-w-full gap-1 text-sm sm:w-auto sm:min-w-[18rem]"
					htmlFor="dining-menu-window"
				>
					<span className="font-medium text-foreground">窗口</span>
					<NativeSelect
						className="min-h-11 min-w-0 max-w-full"
						id="dining-menu-window"
						onChange={(event) => setSelectedWindowId(event.target.value)}
						value={selectedWindowId}
					>
						<option value="">全部窗口</option>
						{windows.map((window) => (
							<option key={window.windowId} value={window.windowId}>
								{window.label}
							</option>
						))}
					</NativeSelect>
				</label>
				<label
					className="flex min-h-11 items-center gap-2 text-sm"
					htmlFor="dining-menu-show-archived"
				>
					<Checkbox
						checked={showArchived}
						id="dining-menu-show-archived"
						onCheckedChange={(checked) => setShowArchived(checked === true)}
					/>
					显示已归档菜品
				</label>
			</div>

			{mutationError ? (
				<div className="mb-4">
					<InlineError error={mutationError} title="菜单修改失败" />
				</div>
			) : null}

			{items.length === 0 ? (
				<div className="border-border border-y py-10 text-center text-muted-foreground text-sm">
					当前范围没有菜品。
				</div>
			) : (
				<DataTable
					caption="菜品列表"
					columns={[
						{
							cell: (item) => (
								<div>
									<p className="font-medium text-foreground">{item.name}</p>
									<p className="mt-1 font-mono text-muted-foreground text-xs">{item.menuItemId}</p>
								</div>
							),
							header: "菜品",
							rowHeader: true,
						},
						{
							cell: (item) => windowLabels.get(item.windowId) ?? item.windowId,
							header: "窗口",
						},
						{ cell: (item) => item.priceText ?? "未填写", header: "价格" },
						{
							cell: (item) =>
								item.archivedAt ? (
									<Badge tone="neutral">已归档</Badge>
								) : (
									<Badge tone="success">已启用</Badge>
								),
							header: "状态",
						},
						{ cell: (item) => formatTimestamp(item.updatedAt), header: "最近修改" },
						{
							cell: (item) => (
								<div className="flex flex-wrap justify-end gap-1">
									{selectedWindowId && !item.archivedAt ? (
										<>
											<Button
												aria-label={`上移 ${item.name}`}
												disabled={
													reorder.isPending || orderedItems[0]?.menuItemId === item.menuItemId
												}
												onClick={() => moveInOrder(item, -1)}
												size="icon"
												variant="ghost"
											>
												<ArrowUp className="size-4" />
											</Button>
											<Button
												aria-label={`下移 ${item.name}`}
												disabled={
													reorder.isPending || orderedItems.at(-1)?.menuItemId === item.menuItemId
												}
												onClick={() => moveInOrder(item, 1)}
												size="icon"
												variant="ghost"
											>
												<ArrowDown className="size-4" />
											</Button>
										</>
									) : null}
									<Button
										aria-label={`编辑 ${item.name}`}
										onClick={() => setEditing(item)}
										size="icon"
										variant="ghost"
									>
										<Pencil className="size-4" />
									</Button>
									<ConfirmAction
										confirmLabel={item.archivedAt ? "恢复" : "归档"}
										description={
											item.archivedAt
												? "恢复后该菜品会立即重新出现在学生端菜单中。"
												: "归档后该菜品不再出现在学生端，已有评价仍会保留。"
										}
										onConfirm={() =>
											archive.mutate({ archived: !item.archivedAt, menuItemId: item.menuItemId })
										}
										title={`${item.archivedAt ? "恢复" : "归档"}“${item.name}”？`}
										trigger={
											<Button
												aria-label={`${item.archivedAt ? "恢复" : "归档"} ${item.name}`}
												disabled={archive.isPending}
												size="icon"
												variant="ghost"
											>
												{item.archivedAt ? (
													<RotateCcw className="size-4" />
												) : (
													<Archive className="size-4" />
												)}
											</Button>
										}
									/>
								</div>
							),
							header: "操作",
						},
					]}
					data={items}
					minWidth="1040px"
					rowKey={(item) => item.menuItemId}
					stickyFirstColumn
					stickyLastColumn
				/>
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
		void props.onSave({
			current: props.item,
			name: name.trim(),
			priceText: priceText.trim() || null,
			windowId,
		});
	};
	return (
		<Dialog onOpenChange={(open) => !open && props.onClose()} open>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{props.item ? "编辑菜品" : "新增菜品"}</DialogTitle>
					<DialogDescription>保存后学生端菜单会在缓存更新后生效。</DialogDescription>
				</DialogHeader>
				<form className="grid gap-4" onSubmit={submit}>
					<label className="grid gap-1 text-sm" htmlFor="menu-item-name">
						<span className="font-medium text-foreground">菜品名称</span>
						<Input
							className="min-h-11"
							id="menu-item-name"
							maxLength={80}
							onChange={(event) => setName(event.target.value)}
							required
							value={name}
						/>
					</label>
					<label className="grid gap-1 text-sm" htmlFor="menu-item-price">
						<span className="font-medium text-foreground">价格</span>
						<Input
							className="min-h-11"
							id="menu-item-price"
							maxLength={40}
							onChange={(event) => setPriceText(event.target.value)}
							placeholder="可留空，例如 12 元"
							value={priceText}
						/>
					</label>
					<label className="grid gap-1 text-sm" htmlFor="menu-item-window">
						<span className="font-medium text-foreground">窗口</span>
						<NativeSelect
							className="min-h-11"
							id="menu-item-window"
							onChange={(event) => setWindowId(event.target.value)}
							required
							value={windowId}
						>
							{props.windows.map((window) => (
								<option key={window.windowId} value={window.windowId}>
									{window.label}
								</option>
							))}
						</NativeSelect>
					</label>
					{props.saveError ? <InlineError error={props.saveError} title="保存失败" /> : null}
					<DialogFooter>
						<Button onClick={props.onClose} type="button" variant="outline">
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
