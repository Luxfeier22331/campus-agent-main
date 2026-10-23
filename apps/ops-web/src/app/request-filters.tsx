import {
	ActionGroup,
	Button,
	Disclosure,
	DisclosureSummary,
	Field,
	Input,
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@campus-agent/ui";
import { useNavigate } from "@tanstack/react-router";
import { CITATION_REASONS, CITATION_STAGE_LABELS } from "campus-contracts/citation-diagnostic";
import { SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { readFailureFilters } from "../shared/failure-filters.ts";
import type { OpsRequestSummary } from "../shared/ops-contract";
import {
	cleanRequestSearch,
	formatRequestViewLabel,
	optionalBoundedSearchString,
	optionalRequestListView,
	optionalStatus,
	type RequestSearchLike,
	requestSearchDraftFromSearch,
} from "./ops-view-helpers";
import { replaceTimeQuery, timeQueryFields } from "./time-filters";
import { FilterSelect } from "./ui/filter-select";
import { TimeRangeFilter } from "./ui/time-window-select";

const exactIdFields = [
	{ label: "请求 ID", name: "requestId", placeholder: "精确 requestId" },
] as const;

type ExactIdFieldName = (typeof exactIdFields)[number]["name"];

export function RequestFilters({ search }: { search: RequestSearchLike }) {
	const navigate = useNavigate();
	const formRef = useRef<HTMLFormElement>(null);
	const mobileFiltersTriggerRef = useRef<HTMLButtonElement>(null);
	const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
	const { q, requestId, status, view, failureCode, failureReason, citationStage, failureScope } =
		search;
	const [draft, setDraft] = useState(() => requestSearchDraftFromSearch(search));
	useEffect(() => {
		setDraft(
			requestSearchDraftFromSearch({
				failureCode,
				failureReason,
				citationStage,
				failureScope,
				q,
				requestId,
				status,
				view,
			}),
		);
	}, [q, requestId, status, view, failureCode, failureReason, citationStage, failureScope]);

	const hasExactFilter = exactIdFields.some((field) => Boolean(draft[field.name]));
	const appliedFilterCount =
		Number(Boolean(failureCode)) +
		Number(Boolean(failureReason)) +
		Number(Boolean(citationStage)) +
		Number(Boolean(failureScope)) +
		Number(search.view === "attention") +
		Number(Boolean(search.q)) +
		Number(Boolean(search.status)) +
		Number(Boolean(search.from || (search.window && search.window !== "today"))) +
		exactIdFields.filter((field) => Boolean(search[field.name])).length;
	const changeMobileFiltersOpen = (open: boolean) => {
		setMobileFiltersOpen(open);
		if (!open) {
			globalThis.setTimeout(() => mobileFiltersTriggerRef.current?.focus(), 0);
		}
	};
	const resetFilters = () => {
		const resetSearch = cleanRequestSearch({});
		setDraft(requestSearchDraftFromSearch({ view: "recent" }));
		void navigate({ search: resetSearch, to: "/requests" });
	};

	return (
		<div className="ops-filter-bar">
			<form
				className="grid gap-3"
				onSubmit={(event) => {
					event.preventDefault();
					void navigate({
						search: {
							...requestSearchFromForm(new FormData(event.currentTarget)),
							...timeQueryFields(search),
						},
						to: "/requests",
					});
				}}
				ref={formRef}
			>
				<input name="view" type="hidden" value={draft.view} />
				<div className="ops-request-primary-filters grid items-end gap-3 md:grid-cols-2 xl:grid-cols-[minmax(16rem,1fr)_9rem_8rem_11rem_auto]">
					<SearchInput
						label="关键词"
						maxLength={256}
						name="q"
						onChange={(name, value) => setDraft((previous) => ({ ...previous, [name]: value }))}
						placeholder="搜索问题、请求 ID 或错误码"
						value={draft.q}
					/>
					<div className="hidden md:block">
						<RequestViewField
							onChange={(view) => setDraft((previous) => ({ ...previous, view }))}
							value={draft.view}
						/>
					</div>
					<div className="hidden md:block">
						<RequestStatusField
							onChange={(status) => setDraft((previous) => ({ ...previous, status }))}
							value={draft.status}
						/>
					</div>
					<div className="hidden md:contents">
						<TimeRangeFilter
							search={search}
							scope="requests"
							onChange={(time) =>
								void navigate({ to: "/requests", search: replaceTimeQuery(search, time) })
							}
						/>
					</div>
					<ActionGroup className="md:col-span-2 xl:col-span-1">
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
							variant="ghost"
						>
							重置
						</Button>
					</ActionGroup>
				</div>
				<Disclosure
					className="hidden border-border border-t px-1 py-2 md:block"
					data-testid="request-exact-filters"
					open={
						hasExactFilter ||
						Boolean(failureCode || failureReason || citationStage || failureScope) ||
						undefined
					}
				>
					<DisclosureSummary className="font-medium text-foreground">
						高级筛选 · 失败原因与精确 ID
					</DisclosureSummary>
					<div className="mt-3">
						<FailureFields
							draft={draft}
							onChange={(name, value) => setDraft((previous) => ({ ...previous, [name]: value }))}
						/>
					</div>
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
				</Disclosure>
				<Sheet onOpenChange={changeMobileFiltersOpen} open={mobileFiltersOpen}>
					<SheetContent
						aria-label="筛选运行记录"
						className="flex flex-col overflow-hidden"
						side="right"
					>
						<SheetHeader className="mb-5 shrink-0 pr-10">
							<SheetTitle>筛选运行记录</SheetTitle>
							<SheetDescription>按运行范围、状态、时间范围或精确 ID 缩小结果。</SheetDescription>
						</SheetHeader>
						<div className="grid min-h-0 flex-1 gap-4 overflow-y-auto pb-4">
							<FailureFields
								draft={draft}
								onChange={(name, value) => setDraft((previous) => ({ ...previous, [name]: value }))}
							/>
							<RequestViewField
								onChange={(view) => setDraft((previous) => ({ ...previous, view }))}
								value={draft.view}
							/>
							<RequestStatusField
								onChange={(status) => setDraft((previous) => ({ ...previous, status }))}
								value={draft.status}
							/>
							<TimeRangeFilter
								search={search}
								scope="requests"
								onChange={(time) =>
									void navigate({ to: "/requests", search: replaceTimeQuery(search, time) })
								}
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
								variant="ghost"
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

function RequestViewField({
	onChange,
	value,
}: {
	onChange: (value: ReturnType<typeof requestSearchDraftFromSearch>["view"]) => void;
	value: ReturnType<typeof requestSearchDraftFromSearch>["view"];
}) {
	return (
		<Field label="运行范围">
			<FilterSelect
				aria-label="运行范围"
				value={value}
				onValueChange={(value) => onChange(optionalRequestListView(value) ?? "recent")}
				options={[
					{ value: "recent", label: formatRequestViewLabel("recent") },
					{ value: "attention", label: formatRequestViewLabel("attention") },
				]}
			/>
		</Field>
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
			<FilterSelect
				aria-label="状态"
				name="status"
				value={value}
				onValueChange={(value) => onChange(optionalStatus(value) ?? "")}
				options={[
					{ value: "", label: "全部状态" },
					{ value: "FAILED", label: "失败" },
					{ value: "ACTION_REQUIRED", label: "等待用户" },
					{ value: "RUNNING", label: "运行中" },
					{ value: "PENDING", label: "待处理" },
					{ value: "COMPLETED", label: "已完成" },
					{ value: "CANCELLED", label: "已取消" },
				]}
			/>
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
		...readFailureFilters(Object.fromEntries(formData.entries())),
		cursor: undefined,
		q: optionalBoundedSearchString(formData.get("q"), 256),
		requestId: optionalBoundedSearchString(formData.get("requestId"), 128),
		status: optionalStatus(formData.get("status")) as OpsRequestSummary["status"] | undefined,
		view: optionalRequestListView(formData.get("view")),
	});
}

type FailureDraft = Pick<
	ReturnType<typeof requestSearchDraftFromSearch>,
	"failureCode" | "failureReason" | "citationStage" | "failureScope"
>;
function FailureFields({
	draft,
	onChange,
}: {
	draft: FailureDraft;
	onChange: (name: keyof FailureDraft, value: string) => void;
}) {
	return (
		<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
			<Field label="失败代码">
				<Input
					name="failureCode"
					pattern="[a-z][a-z0-9_]{0,63}"
					title="使用小写字母、数字和下划线，以字母开头"
					maxLength={64}
					value={draft.failureCode}
					placeholder="例如 citation_validation_failed"
					onChange={(event) => onChange("failureCode", event.target.value)}
				/>
			</Field>
			<Field label="失败原因">
				<FilterSelect
					name="failureReason"
					value={draft.failureReason}
					onValueChange={(value) => onChange("failureReason", value)}
					options={[
						{ value: "", label: "全部原因" },
						...(draft.failureReason && !(draft.failureReason in CITATION_REASONS)
							? [{ value: draft.failureReason, label: draft.failureReason }]
							: []),
						...Object.entries(CITATION_REASONS).map(([value, label]) => ({ value, label })),
					]}
				/>
			</Field>
			<Field label="校验阶段">
				<FilterSelect
					name="citationStage"
					value={draft.citationStage}
					onValueChange={(value) => onChange("citationStage", value)}
					options={[
						{ value: "", label: "全部校验阶段" },
						...Object.entries(CITATION_STAGE_LABELS).map(([value, label]) => ({ value, label })),
					]}
				/>
			</Field>
			<Field label="失败范围">
				<FilterSelect
					name="failureScope"
					value={draft.failureScope}
					onValueChange={(value) => onChange("failureScope", value)}
					options={[
						{ value: "", label: "不限定" },
						{ value: "any", label: "任一失败" },
						{ value: "stage", label: "执行阶段失败" },
						{ value: "terminal", label: "回答终态失败" },
					]}
				/>
			</Field>
		</div>
	);
}
