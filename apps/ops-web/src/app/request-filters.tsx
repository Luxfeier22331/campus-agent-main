import {
	ActionGroup,
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
		Number(draft.view === "attention") +
		Number(Boolean(draft.q)) +
		Number(Boolean(draft.status)) +
		Number(Boolean(search.from || (search.window && search.window !== "today"))) +
		exactIdFields.filter((field) => Boolean(draft[field.name])).length;
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
		<div className="border-border border-y bg-background py-3 sm:py-4">
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
				<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(15rem,1fr)_11rem_9rem_9rem_auto] xl:items-end">
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
					<div className="hidden md:block">
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
							variant="outline"
						>
							重置
						</Button>
					</ActionGroup>
				</div>
				<div className="hidden md:block border-border border-t py-3">
					<FailureFields
						draft={draft}
						onChange={(name, value) => setDraft((previous) => ({ ...previous, [name]: value }))}
					/>
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
						aria-label="筛选运行诊断"
						className="flex flex-col overflow-hidden"
						side="right"
					>
						<SheetHeader className="mb-5 shrink-0 pr-10">
							<SheetTitle>筛选运行诊断</SheetTitle>
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

function RequestViewField({
	onChange,
	value,
}: {
	onChange: (value: ReturnType<typeof requestSearchDraftFromSearch>["view"]) => void;
	value: ReturnType<typeof requestSearchDraftFromSearch>["view"];
}) {
	return (
		<Field label="运行范围">
			<NativeSelect
				aria-label="运行范围"
				className="min-h-11"
				onChange={(event) => onChange(optionalRequestListView(event.target.value) ?? "recent")}
				value={value}
			>
				<option value="recent">{formatRequestViewLabel("recent")}</option>
				<option value="attention">{formatRequestViewLabel("attention")}</option>
			</NativeSelect>
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
				<NativeSelect
					name="failureReason"
					value={draft.failureReason}
					onChange={(event) => onChange("failureReason", event.target.value)}
				>
					<option value="">全部原因</option>
					{draft.failureReason && !(draft.failureReason in CITATION_REASONS) ? (
						<option value={draft.failureReason}>{draft.failureReason}</option>
					) : null}
					{Object.entries(CITATION_REASONS).map(([value, label]) => (
						<option key={value} value={value}>
							{label}
						</option>
					))}
				</NativeSelect>
			</Field>
			<Field label="校验阶段">
				<NativeSelect
					name="citationStage"
					value={draft.citationStage}
					onChange={(event) => onChange("citationStage", event.target.value)}
				>
					<option value="">全部校验阶段</option>
					{Object.entries(CITATION_STAGE_LABELS).map(([value, label]) => (
						<option key={value} value={value}>
							{label}
						</option>
					))}
				</NativeSelect>
			</Field>
			<Field label="失败范围">
				<NativeSelect
					name="failureScope"
					value={draft.failureScope}
					onChange={(event) => onChange("failureScope", event.target.value)}
				>
					<option value="">不限定</option>
					<option value="any">任一失败</option>
					<option value="stage">执行阶段失败</option>
					<option value="terminal">回答终态失败</option>
				</NativeSelect>
			</Field>
		</div>
	);
}
