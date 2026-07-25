import {
	Button,
	Field,
	Input,
	NativeSelect,
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@campus-agent/ui";
import { useNavigate } from "@tanstack/react-router";
import { SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { OpsRequestSummary } from "../shared/ops-contract";
import {
	cleanRequestSearch,
	optionalBoundedSearchString,
	optionalRequestListView,
	optionalRequestWindow,
	optionalStatus,
	type RequestSearchLike,
	requestSearchDraftFromSearch,
} from "./ops-view-helpers";

const exactIdFields = [
	{ label: "请求 ID", name: "requestId", placeholder: "精确 requestId" },
	{ label: "运行 ID", name: "runId", placeholder: "精确 runId" },
	{ label: "工作流 ID", name: "workflowId", placeholder: "精确 workflowId" },
	{ label: "调用链 ID", name: "traceId", placeholder: "精确 traceId" },
	{ label: "会话 ID", name: "conversationId", placeholder: "精确 conversationId" },
] as const;

type ExactIdFieldName = (typeof exactIdFields)[number]["name"];

export function RequestFilters({ search }: { search: RequestSearchLike }) {
	const navigate = useNavigate();
	const formRef = useRef<HTMLFormElement>(null);
	const mobileFiltersTriggerRef = useRef<HTMLButtonElement>(null);
	const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
	const { conversationId, q, requestId, runId, status, traceId, view, window, workflowId } = search;
	const [draft, setDraft] = useState(() => requestSearchDraftFromSearch(search));
	useEffect(() => {
		setDraft(
			requestSearchDraftFromSearch({
				conversationId,
				q,
				requestId,
				runId,
				status,
				traceId,
				view,
				window,
				workflowId,
			}),
		);
	}, [conversationId, q, requestId, runId, status, traceId, view, window, workflowId]);

	const hasExactFilter = exactIdFields.some((field) => Boolean(draft[field.name]));
	const appliedFilterCount =
		Number(Boolean(draft.status)) +
		Number(draft.window !== "1h") +
		exactIdFields.filter((field) => Boolean(draft[field.name])).length;
	const changeMobileFiltersOpen = (open: boolean) => {
		setMobileFiltersOpen(open);
		if (!open) {
			globalThis.setTimeout(() => mobileFiltersTriggerRef.current?.focus(), 0);
		}
	};
	const resetFilters = () => {
		const resetSearch = cleanRequestSearch({ view: search.view });
		setDraft(requestSearchDraftFromSearch({ view: search.view ?? "recent" }));
		void navigate({ search: resetSearch, to: "/requests" });
	};

	return (
		<div className="border-border border-y bg-background py-3 sm:py-4">
			<form
				className="grid gap-3"
				onSubmit={(event) => {
					event.preventDefault();
					void navigate({
						search: requestSearchFromForm(new FormData(event.currentTarget)),
						to: "/requests",
					});
				}}
				ref={formRef}
			>
				<input name="view" type="hidden" value={draft.view} />
				<div className="grid gap-3 md:grid-cols-[minmax(15rem,1fr)_9rem_9rem_auto] md:items-end">
					<SearchInput
						label="关键词"
						maxLength={256}
						name="q"
						onChange={(name, value) => setDraft((previous) => ({ ...previous, [name]: value }))}
						placeholder="搜索问题、ID 或错误码"
						value={draft.q}
					/>
					<div className="hidden md:block">
						<RequestStatusField
							onChange={(status) => setDraft((previous) => ({ ...previous, status }))}
							value={draft.status}
						/>
					</div>
					<div className="hidden md:block">
						<RequestWindowField
							onChange={(window) => setDraft((previous) => ({ ...previous, window }))}
							value={draft.window}
						/>
					</div>
					<div className="flex gap-2">
						<Button
							className="flex-1 md:hidden"
							onClick={() => changeMobileFiltersOpen(true)}
							ref={mobileFiltersTriggerRef}
							type="button"
							variant="outline"
						>
							<SlidersHorizontal className="size-4" />
							{appliedFilterCount > 0 ? `筛选（${appliedFilterCount}）` : "筛选"}
						</Button>
						<Button className="min-h-11 flex-1 md:flex-none" type="submit">
							<span className="md:hidden">搜索</span>
							<span className="hidden md:inline">应用</span>
						</Button>
						<Button
							className="hidden md:inline-flex"
							onClick={resetFilters}
							type="button"
							variant="outline"
						>
							重置
						</Button>
					</div>
				</div>
				<details
					className="hidden border-border border-t px-1 py-2 md:block"
					data-testid="request-exact-filters"
					open={hasExactFilter || undefined}
				>
					<summary className="flex min-h-9 cursor-pointer items-center font-medium text-foreground text-sm">
						精确 ID 筛选
					</summary>
					<div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
						{exactIdFields.map((field) => (
							<SearchInput
								key={field.name}
								label={field.label}
								maxLength={128}
								name={field.name}
								onChange={(name, value) => setDraft((previous) => ({ ...previous, [name]: value }))}
								placeholder={field.placeholder}
								value={draft[field.name]}
							/>
						))}
					</div>
				</details>
				<Sheet onOpenChange={changeMobileFiltersOpen} open={mobileFiltersOpen}>
					<SheetContent
						aria-label="筛选运行记录"
						className="flex flex-col overflow-hidden"
						side="right"
					>
						<SheetHeader className="mb-5 shrink-0 pr-10">
							<SheetTitle>筛选运行记录</SheetTitle>
							<SheetDescription>按状态、时间范围或精确 ID 缩小结果。</SheetDescription>
						</SheetHeader>
						<div className="grid min-h-0 flex-1 gap-4 overflow-y-auto pb-4">
							<RequestStatusField
								onChange={(status) => setDraft((previous) => ({ ...previous, status }))}
								value={draft.status}
							/>
							<RequestWindowField
								onChange={(window) => setDraft((previous) => ({ ...previous, window }))}
								value={draft.window}
							/>
							<div className="border-border border-t pt-4">
								<p className="mb-3 font-medium text-sm">精确 ID</p>
								<div className="grid gap-3">
									{exactIdFields.map((field) => (
										<SearchInput
											key={field.name}
											label={field.label}
											maxLength={128}
											name={field.name}
											onChange={(name, value) =>
												setDraft((previous) => ({ ...previous, [name]: value }))
											}
											placeholder={field.placeholder}
											value={draft[field.name]}
										/>
									))}
								</div>
							</div>
						</div>
						<SheetFooter className="shrink-0 border-border border-t bg-background pt-4">
							<Button
								onClick={() => {
									changeMobileFiltersOpen(false);
									formRef.current?.requestSubmit();
								}}
							>
								应用筛选
							</Button>
							<Button
								onClick={() => {
									changeMobileFiltersOpen(false);
									resetFilters();
								}}
								type="button"
								variant="outline"
							>
								重置
							</Button>
						</SheetFooter>
					</SheetContent>
				</Sheet>
			</form>
		</div>
	);
}

function RequestStatusField({
	onChange,
	value,
}: {
	onChange: (value: ReturnType<typeof requestSearchDraftFromSearch>["status"]) => void;
	value: ReturnType<typeof requestSearchDraftFromSearch>["status"];
}) {
	return (
		<Field label="状态">
			<NativeSelect
				aria-label="状态"
				className="min-h-11"
				name="status"
				onChange={(event) => onChange(optionalStatus(event.target.value) ?? "")}
				value={value}
			>
				<option value="">全部状态</option>
				<option value="FAILED">失败</option>
				<option value="ACTION_REQUIRED">等待用户</option>
				<option value="RUNNING">运行中</option>
				<option value="PENDING">待处理</option>
				<option value="COMPLETED">已完成</option>
				<option value="CANCELLED">已取消</option>
			</NativeSelect>
		</Field>
	);
}

function RequestWindowField({
	onChange,
	value,
}: {
	onChange: (value: ReturnType<typeof requestSearchDraftFromSearch>["window"]) => void;
	value: ReturnType<typeof requestSearchDraftFromSearch>["window"];
}) {
	return (
		<Field label="时间范围">
			<NativeSelect
				aria-label="时间范围"
				className="min-h-11"
				name="window"
				onChange={(event) => onChange(optionalRequestWindow(event.target.value) ?? "1h")}
				value={value}
			>
				<option value="15m">15 分钟</option>
				<option value="1h">1 小时</option>
				<option value="6h">6 小时</option>
				<option value="24h">24 小时</option>
				<option value="7d">7 天</option>
			</NativeSelect>
		</Field>
	);
}

function SearchInput({
	label,
	maxLength,
	name,
	onChange,
	placeholder,
	value,
}: {
	label: string;
	maxLength: number;
	name: ExactIdFieldName | "q";
	onChange: (name: ExactIdFieldName | "q", value: string) => void;
	placeholder: string;
	value?: string;
}) {
	return (
		<Field label={label}>
			<Input
				className="min-h-11"
				maxLength={maxLength}
				name={name}
				onChange={(event) => onChange(name, event.target.value)}
				placeholder={placeholder}
				value={value ?? ""}
			/>
		</Field>
	);
}

function requestSearchFromForm(formData: FormData): RequestSearchLike {
	return cleanRequestSearch({
		conversationId: optionalBoundedSearchString(formData.get("conversationId"), 128),
		cursor: undefined,
		q: optionalBoundedSearchString(formData.get("q"), 256),
		requestId: optionalBoundedSearchString(formData.get("requestId"), 128),
		runId: optionalBoundedSearchString(formData.get("runId"), 128),
		status: optionalStatus(formData.get("status")) as OpsRequestSummary["status"] | undefined,
		traceId: optionalBoundedSearchString(formData.get("traceId"), 128),
		view: optionalRequestListView(formData.get("view")),
		window: optionalRequestWindow(formData.get("window")),
		workflowId: optionalBoundedSearchString(formData.get("workflowId"), 128),
	});
}
