import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { OpsRequestSummary } from "../shared/ops-contract";
import {
	cleanRequestSearch,
	formatStatusLabel,
	optionalBoundedSearchString,
	optionalLimit,
	optionalRequestWindow,
	optionalStatus,
	type RequestSearchLike,
	requestSearchDraftFromSearch,
} from "./ops-view-helpers";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";

const exactIdFields = [
	{ label: "requestId", name: "requestId", placeholder: "精确 requestId" },
	{ label: "traceId", name: "traceId", placeholder: "精确 traceId" },
	{ label: "conversationId", name: "conversationId", placeholder: "精确 conversationId" },
] as const;

export function RequestFilters({ search }: { search: RequestSearchLike }) {
	const navigate = useNavigate();
	const { conversationId, limit, q, requestId, status, traceId, window } = search;
	const [draft, setDraft] = useState(() => requestSearchDraftFromSearch(search));
	useEffect(() => {
		setDraft(
			requestSearchDraftFromSearch({
				conversationId,
				limit,
				q,
				requestId,
				status,
				traceId,
				window,
			}),
		);
	}, [conversationId, limit, q, requestId, status, traceId, window]);
	return (
		<Card>
			<CardContent className="p-3 sm:p-4">
				<form
					className="grid grid-cols-2 gap-3 md:grid-cols-6 xl:grid-cols-8"
					onSubmit={(event) => {
						event.preventDefault();
						const formSearch = requestSearchFromForm(new FormData(event.currentTarget));
						void navigate({
							search: formSearch,
							to: "/requests",
						});
					}}
				>
					<label className="grid gap-1 text-sm">
						<span className="font-medium text-slate-600">状态</span>
						<select
							aria-label="状态筛选"
							className="min-h-11 rounded-md border border-slate-200 bg-white px-3 text-sm"
							name="status"
							onChange={(event) => {
								setDraft((previous) => ({ ...previous, status: event.target.value }));
							}}
							value={draft.status}
						>
							<option value="">全部</option>
							<option value="COMPLETED">{formatStatusLabel("COMPLETED")}</option>
							<option value="RUNNING">{formatStatusLabel("RUNNING")}</option>
							<option value="FAILED">{formatStatusLabel("FAILED")}</option>
							<option value="CANCELLED">{formatStatusLabel("CANCELLED")}</option>
							<option value="PENDING">{formatStatusLabel("PENDING")}</option>
						</select>
					</label>
					<label className="grid gap-1 text-sm">
						<span className="font-medium text-slate-600">时间范围</span>
						<select
							aria-label="时间范围"
							className="min-h-11 rounded-md border border-slate-200 bg-white px-3 text-sm"
							name="window"
							onChange={(event) =>
								setDraft((previous) => ({
									...previous,
									window: optionalRequestWindow(event.target.value) ?? "1h",
								}))
							}
							value={draft.window}
						>
							<option value="1h">1 小时</option>
							<option value="6h">6 小时</option>
							<option value="24h">24 小时</option>
							<option value="7d">7 天</option>
						</select>
					</label>
					<label className="grid gap-1 text-sm">
						<span className="font-medium text-slate-600">每页数量</span>
						<input
							aria-label="每页数量"
							className="min-h-11 rounded-md border border-slate-200 bg-white px-3 text-sm"
							inputMode="numeric"
							max={100}
							min={1}
							name="limit"
							onChange={(event) => {
								setDraft((previous) => ({ ...previous, limit: event.target.value }));
							}}
							step={1}
							type="number"
							value={draft.limit}
						/>
					</label>
					<SearchInput
						className="col-span-2 md:col-span-2 xl:col-span-2"
						label="关键词"
						maxLength={256}
						name="q"
						onChange={(key, value) => setDraft((previous) => ({ ...previous, [key]: value }))}
						placeholder="可搜 ID、问题、工具和错误码"
						value={draft.q}
					/>
					<div className="hidden md:contents" data-testid="request-exact-filters-desktop">
						{exactIdFields.map((field) => (
							<SearchInput
								className="col-span-2"
								key={`desktop-${field.name}`}
								label={field.label}
								maxLength={128}
								name={field.name}
								onChange={(key, value) => setDraft((previous) => ({ ...previous, [key]: value }))}
								placeholder={field.placeholder}
								value={draft[field.name]}
							/>
						))}
					</div>
					<details
						className="col-span-2 rounded-md border border-slate-200 bg-white p-3 md:hidden"
						data-testid="request-exact-filters"
						open={Boolean(draft.requestId || draft.traceId || draft.conversationId) || undefined}
					>
						<summary className="flex min-h-11 cursor-pointer items-center font-medium text-slate-700 text-sm">
							精确 ID 筛选
						</summary>
						<div className="mt-3 grid gap-3">
							{exactIdFields.map((field) => (
								<SearchInput
									key={`mobile-${field.name}`}
									label={field.label}
									maxLength={128}
									name={field.name}
									onChange={(key, value) => setDraft((previous) => ({ ...previous, [key]: value }))}
									placeholder={field.placeholder}
									value={draft[field.name]}
								/>
							))}
						</div>
					</details>
					<div className="col-span-2 flex flex-col items-stretch gap-2 sm:flex-row md:items-end xl:col-span-1">
						<Button className="w-full" type="submit">
							应用
						</Button>
						<Button asChild className="w-full" variant="outline">
							<Link
								onClick={() => setDraft(requestSearchDraftFromSearch({}))}
								search={cleanRequestSearch({})}
								to="/requests"
							>
								重置
							</Link>
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}

function SearchInput({
	className,
	label,
	maxLength,
	name,
	onChange,
	placeholder,
	value,
}: {
	className?: string;
	label: string;
	maxLength: number;
	name: "conversationId" | "q" | "requestId" | "traceId";
	onChange: (
		key: "conversationId" | "limit" | "q" | "requestId" | "status" | "traceId",
		value: string,
	) => void;
	placeholder: string;
	value?: string;
}) {
	return (
		<label className={`grid gap-1 text-sm ${className ?? ""}`}>
			<span className="font-medium text-slate-600">{label}</span>
			<input
				className="min-h-11 rounded-md border border-slate-200 bg-white px-3 text-sm"
				maxLength={maxLength}
				name={name}
				onChange={(event) => onChange(name, event.target.value)}
				placeholder={placeholder}
				value={value ?? ""}
			/>
		</label>
	);
}

function requestSearchFromForm(formData: FormData): RequestSearchLike {
	return cleanRequestSearch({
		conversationId: optionalBoundedSearchString(formData.get("conversationId"), 128),
		cursor: undefined,
		limit: optionalLimit(formData.get("limit")),
		q: optionalBoundedSearchString(formData.get("q"), 256),
		requestId: optionalBoundedSearchString(formData.get("requestId"), 128),
		status: optionalStatus(formData.get("status")) as OpsRequestSummary["status"] | undefined,
		traceId: optionalBoundedSearchString(formData.get("traceId"), 128),
		window: optionalRequestWindow(formData.get("window")),
	});
}
