import type {
	ProviderConfigConnectionSummary,
	ProviderConfigKind,
	ProviderConfigProfileSummary,
} from "@campus-agent/provider-config";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Pencil, Play, Plus, X } from "lucide-react";
import { useState } from "react";
import {
	activateProviderProfile,
	createProviderConnection,
	createProviderProfile,
	fetchProviderConfig,
	updateProviderConnection,
	updateProviderProfile,
	validateProviderProfile,
} from "./ops-api-client";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

const inputClass =
	"min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-200";
const labelClass = "grid gap-1.5 font-medium text-slate-700 text-sm";

export function ProviderConfigPage() {
	const queryClient = useQueryClient();
	const query = useQuery({
		queryFn: ({ signal }) => fetchProviderConfig({ signal }),
		queryKey: ["provider-config"],
	});
	const [error, setError] = useState<string | null>(null);
	const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);
	const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
	const visibleError = error ?? (query.error instanceof Error ? query.error.message : null);
	const refresh = () => queryClient.invalidateQueries({ queryKey: ["provider-config"] });
	const editingConnection = query.data?.connections.find(
		(connection) => connection.connectionId === editingConnectionId,
	);
	const editingProfile = query.data?.profiles.find(
		(profile) => profile.profileId === editingProfileId,
	);
	const activeConnectionIds = new Set(
		(query.data?.profiles ?? [])
			.filter((profile) => profile.active)
			.map((profile) => profile.connectionId),
	);
	const action = useMutation({
		mutationFn: async (input: { kind: "activate" | "validate"; profileId: string }) =>
			input.kind === "activate"
				? activateProviderProfile(input.profileId)
				: validateProviderProfile(input.profileId),
		onError: (value) => setError(value instanceof Error ? value.message : "操作失败。"),
		onSuccess: async () => {
			setError(null);
			await refresh();
		},
	});
	const createConnection = useMutation({
		mutationFn: createProviderConnection,
		onError: (value) => setError(value instanceof Error ? value.message : "保存连接失败。"),
		onSuccess: async () => {
			setError(null);
			await refresh();
		},
	});
	const createProfile = useMutation({
		mutationFn: createProviderProfile,
		onError: (value) => setError(value instanceof Error ? value.message : "保存配置失败。"),
		onSuccess: async () => {
			setError(null);
			await refresh();
		},
	});
	const editConnection = useMutation({
		mutationFn: (input: { connectionId: string; payload: Record<string, unknown> }) =>
			updateProviderConnection(input.connectionId, input.payload),
		onError: (value) => setError(value instanceof Error ? value.message : "更新连接失败。"),
		onSuccess: async () => {
			setEditingConnectionId(null);
			setError(null);
			await refresh();
		},
	});
	const editProfile = useMutation({
		mutationFn: (input: { payload: Record<string, unknown>; profileId: string }) =>
			updateProviderProfile(input.profileId, input.payload),
		onError: (value) => setError(value instanceof Error ? value.message : "更新配置失败。"),
		onSuccess: async () => {
			setEditingProfileId(null);
			setError(null);
			await refresh();
		},
	});

	return (
		<div className="mx-auto grid max-w-7xl gap-5">
			<header className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<p className="font-semibold text-slate-500 text-xs">运行配置</p>
					<h1 className="font-semibold text-2xl text-slate-950">模型服务配置</h1>
					{query.data?.runtime.configured ? (
						<p
							className="mt-1 max-w-3xl truncate text-slate-500 text-xs"
							title={query.data.runtime.publicationId ?? undefined}
						>
							{query.data.runtime.publicationId} · {query.data.runtime.publishedBy?.displayName} ·{" "}
							{formatPublicationTime(query.data.runtime.publishedAt)}
						</p>
					) : null}
				</div>
				<Badge tone={query.data?.runtime.configured ? "success" : "warning"}>
					{query.data?.runtime.configured ? "运行时已发布" : "运行时未配置"}
				</Badge>
			</header>
			{visibleError ? (
				<div
					className="rounded-md border border-red-200 bg-red-50 p-3 text-red-800 text-sm"
					role="alert"
				>
					{visibleError}
				</div>
			) : null}
			{query.data?.runtime.configured ? (
				<section
					aria-labelledby="active-provider-profiles"
					className="overflow-hidden rounded-lg border border-slate-200 bg-white"
				>
					<div className="border-slate-200 border-b p-4 sm:p-5">
						<h2 className="font-semibold text-base" id="active-provider-profiles">
							当前生效配置
						</h2>
					</div>
					<div className="grid gap-px bg-slate-100 sm:grid-cols-2 xl:grid-cols-3">
						{Object.entries(query.data.runtime.profiles).map(([role, profile]) => (
							<div className="bg-white p-4" key={role}>
								<p className="font-medium text-slate-950 text-sm">{role}</p>
								<p className="mt-1 truncate text-slate-600 text-sm" title={profile.model}>
									{profile.model}
								</p>
								<p className="mt-1 text-slate-400 text-xs">
									{profile.provider} · revision {profile.revision}
								</p>
							</div>
						))}
					</div>
				</section>
			) : null}
			<div className="grid gap-5 xl:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>新增连接</CardTitle>
					</CardHeader>
					<CardContent>
						<ConnectionForm
							pending={createConnection.isPending}
							onSubmit={(payload) => createConnection.mutateAsync(payload)}
						/>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>新增配置</CardTitle>
					</CardHeader>
					<CardContent>
						<ProfileForm
							connections={query.data?.connections ?? []}
							pending={createProfile.isPending}
							onSubmit={(payload) => createProfile.mutateAsync(payload)}
						/>
					</CardContent>
				</Card>
			</div>
			{editingConnection ? (
				<Card>
					<CardHeader className="flex-row items-center justify-between space-y-0">
						<CardTitle>编辑连接</CardTitle>
						<Button
							aria-label="取消编辑连接"
							className="size-11 px-0"
							onClick={() => setEditingConnectionId(null)}
							title="取消"
							variant="ghost"
						>
							<X className="size-4" />
						</Button>
					</CardHeader>
					<CardContent>
						<ConnectionForm
							initial={editingConnection}
							pending={editConnection.isPending}
							onSubmit={(payload) =>
								editConnection.mutateAsync({
									connectionId: editingConnection.connectionId,
									payload,
								})
							}
						/>
					</CardContent>
				</Card>
			) : null}
			{editingProfile ? (
				<Card>
					<CardHeader className="flex-row items-center justify-between space-y-0">
						<CardTitle>编辑配置</CardTitle>
						<Button
							aria-label="取消编辑配置"
							className="size-11 px-0"
							onClick={() => setEditingProfileId(null)}
							title="取消"
							variant="ghost"
						>
							<X className="size-4" />
						</Button>
					</CardHeader>
					<CardContent>
						<ProfileForm
							connections={query.data?.connections ?? []}
							initial={editingProfile}
							pending={editProfile.isPending}
							onSubmit={(payload) =>
								editProfile.mutateAsync({ payload, profileId: editingProfile.profileId })
							}
						/>
					</CardContent>
				</Card>
			) : null}
			<section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
				<div className="border-slate-200 border-b p-4 sm:p-5">
					<h2 className="font-semibold text-base">服务连接</h2>
				</div>
				<div className="overflow-x-auto">
					<table className="w-full text-left text-sm">
						<thead className="bg-slate-50 text-slate-600">
							<tr>
								<th className="px-4 py-3">服务</th>
								<th className="px-4 py-3">端点</th>
								<th className="px-4 py-3">能力</th>
								<th className="px-4 py-3">密钥</th>
								<th className="px-4 py-3 text-right">操作</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-100">
							{(query.data?.connections ?? []).map((connection) => {
								const active = activeConnectionIds.has(connection.connectionId);
								return (
									<tr key={connection.connectionId}>
										<td className="px-4 py-3 font-medium">{connection.provider}</td>
										<td className="max-w-xs truncate px-4 py-3" title={connection.baseUrl}>
											{connection.baseUrl}
										</td>
										<td className="px-4 py-3">{connection.features.join(" / ")}</td>
										<td className="px-4 py-3 font-mono text-xs">••••{connection.secretLast4}</td>
										<td className="px-4 py-3 text-right">
											<Button
												aria-label="编辑连接"
												disabled={active}
												onClick={() => {
													setEditingProfileId(null);
													setEditingConnectionId(connection.connectionId);
												}}
												title={active ? "当前生效连接不可原地修改" : "编辑连接"}
												variant="outline"
											>
												<Pencil className="size-4" />
												编辑
											</Button>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
				{query.data?.connections.length === 0 ? (
					<p className="p-5 text-slate-500 text-sm">暂无服务连接</p>
				) : null}
			</section>
			<section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
				<div className="border-slate-200 border-b p-4 sm:p-5">
					<h2 className="font-semibold text-base">配置档案</h2>
				</div>
				<div className="overflow-x-auto">
					<table className="w-full text-left text-sm">
						<thead className="bg-slate-50 text-slate-600">
							<tr>
								<th className="px-4 py-3">角色</th>
								<th className="px-4 py-3">模型</th>
								<th className="px-4 py-3">状态</th>
								<th className="px-4 py-3">连接</th>
								<th className="px-4 py-3 text-right">操作</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-100">
							{(query.data?.profiles ?? []).map((profile) => (
								<tr key={profile.profileId}>
									<td className="px-4 py-3 font-medium">{profile.role}</td>
									<td className="px-4 py-3">{profile.model}</td>
									<td className="px-4 py-3">
										<Badge
											tone={
												profile.active
													? "success"
													: profile.status === "validation_failed"
														? "danger"
														: "default"
											}
										>
											{profile.active ? "当前生效" : statusLabel(profile.status)}
										</Badge>
									</td>
									<td className="px-4 py-3 font-mono text-xs">{profile.provider}</td>
									<td className="px-4 py-3">
										<div className="flex justify-end gap-2">
											<Button
												aria-label="编辑配置"
												disabled={profile.active}
												onClick={() => {
													setEditingConnectionId(null);
													setEditingProfileId(profile.profileId);
												}}
												title={profile.active ? "当前生效配置不可原地修改" : "编辑配置"}
												variant="outline"
											>
												<Pencil className="size-4" />
												编辑
											</Button>
											<Button
												aria-label="验证配置"
												disabled={action.isPending || profile.active}
												onClick={() =>
													action.mutate({ kind: "validate", profileId: profile.profileId })
												}
												variant="outline"
											>
												<CheckCircle2 className="size-4" />
												验证
											</Button>
											<Button
												aria-label="激活配置"
												disabled={
													action.isPending || profile.active || profile.status !== "validated"
												}
												onClick={() =>
													action.mutate({ kind: "activate", profileId: profile.profileId })
												}
											>
												<Play className="size-4" />
												激活
											</Button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				{query.isLoading ? <p className="p-5 text-slate-500 text-sm">正在读取...</p> : null}
				{query.data?.profiles.length === 0 ? (
					<p className="p-5 text-slate-500 text-sm">暂无配置档案</p>
				) : null}
			</section>
		</div>
	);
}

function ConnectionForm({
	initial,
	pending,
	onSubmit,
}: {
	initial?: ProviderConfigConnectionSummary;
	pending: boolean;
	onSubmit(payload: Record<string, unknown>): Promise<unknown>;
}) {
	return (
		<form
			aria-label={initial ? "编辑连接" : "新增连接"}
			className="grid gap-3"
			onSubmit={async (event) => {
				event.preventDefault();
				const form = event.currentTarget;
				const data = new FormData(form);
				const selected = data.get("features");
				const apiKey = String(data.get("apiKey") ?? "").trim();
				try {
					const nextFeatures =
						selected === "prompt_embedding" ? ["prompt", "embedding"] : [selected];
					const payload: Record<string, unknown> = {
						baseUrl: data.get("baseUrl"),
						featureConfig:
							initial && selected === connectionFeatureValue(initial.features)
								? initial.featureConfig
								: selected === "rerank"
									? { rerank: { path: "/rerank" } }
									: {},
						features: nextFeatures,
						provider: data.get("provider"),
					};
					if (apiKey) {
						payload.apiKey = apiKey;
					}
					await onSubmit(payload);
					form.reset();
				} catch {
					/* mutation state owns the visible error */
				}
			}}
		>
			<label className={labelClass}>
				服务类型
				<select className={inputClass} defaultValue={initial?.provider} name="provider">
					<option value="openai-compatible">OpenAI-compatible</option>
					<option value="openai">OpenAI</option>
					<option value="gitee">Gitee AI</option>
				</select>
			</label>
			<label className={labelClass}>
				服务端点
				<input
					className={inputClass}
					defaultValue={initial?.baseUrl}
					name="baseUrl"
					placeholder="https://api.example.com/v1"
					required
				/>
			</label>
			<label className={labelClass}>
				支持能力
				<select
					className={inputClass}
					defaultValue={initial ? connectionFeatureValue(initial.features) : "prompt_embedding"}
					name="features"
				>
					<option value="prompt_embedding">文本与向量</option>
					<option value="prompt">文本</option>
					<option value="embedding">向量</option>
					<option value="rerank">重排</option>
				</select>
			</label>
			<label className={labelClass}>
				API Key
				<input
					autoComplete="off"
					className={inputClass}
					name="apiKey"
					placeholder={initial ? `留空则保留当前密钥（••••${initial.secretLast4}）` : undefined}
					required={!initial}
					type="password"
				/>
			</label>
			<Button disabled={pending} type="submit">
				{initial ? <Pencil className="size-4" /> : <Plus className="size-4" />}
				{initial ? "保存连接修改" : "保存连接"}
			</Button>
		</form>
	);
}
function ProfileForm({
	connections,
	initial,
	pending,
	onSubmit,
}: {
	connections: Array<{ connectionId: string; provider: string }>;
	initial?: ProviderConfigProfileSummary;
	pending: boolean;
	onSubmit(payload: Record<string, unknown>): Promise<unknown>;
}) {
	const [kind, setKind] = useState<ProviderConfigKind>(initial?.kind ?? "prompt");
	return (
		<form
			aria-label={initial ? "编辑配置" : "新增配置"}
			className="grid gap-3"
			onSubmit={async (event) => {
				event.preventDefault();
				const form = event.currentTarget;
				const data = new FormData(form);
				try {
					const payload: Record<string, unknown> = {
						connectionId: data.get("connectionId"),
						dimensions: kind === "embedding" ? Number(data.get("dimensions")) : undefined,
						model: data.get("model"),
						timeoutMs: Number(data.get("timeoutMs")),
						transport: initial?.transport ?? data.get("transport"),
					};
					if (!initial) {
						payload.kind = kind;
						payload.role = data.get("role");
					}
					await onSubmit(payload);
					form.reset();
					if (!initial) {
						setKind("prompt");
					}
				} catch {
					/* mutation state owns the visible error */
				}
			}}
		>
			<label className={labelClass}>
				连接
				<select
					className={inputClass}
					defaultValue={initial?.connectionId ?? ""}
					name="connectionId"
					required
				>
					<option disabled value="">
						请选择连接
					</option>
					{connections.map((item) => (
						<option key={item.connectionId} value={item.connectionId}>
							{item.provider} · {item.connectionId.slice(-8)}
						</option>
					))}
				</select>
			</label>
			<label className={labelClass}>
				类型
				<select
					className={inputClass}
					disabled={Boolean(initial)}
					onChange={(event) => setKind(event.target.value as ProviderConfigKind)}
					value={kind}
				>
					<option value="prompt">文本生成</option>
					<option value="embedding">向量</option>
					<option value="rerank">重排</option>
				</select>
			</label>
			<label className={labelClass}>
				角色
				<select className={inputClass} disabled={Boolean(initial)} name="role">
					{(kind === "prompt"
						? [
								"primary_agent",
								"rag_synthesis",
								"hindsight_llm",
								"eval_judge_llm",
								"eval_ragas_llm",
							]
						: kind === "embedding"
							? [
									"rag_query_embedding",
									"index_embedding",
									"hindsight_embedding",
									"eval_ragas_embedding",
								]
							: ["rag_reranker"]
					).map((role) => (
						<option key={role} value={role}>
							{role}
						</option>
					))}
				</select>
			</label>
			<label className={labelClass}>
				模型
				<input className={inputClass} defaultValue={initial?.model} name="model" required />
			</label>
			<input
				name="transport"
				type="hidden"
				value={
					kind === "prompt" ? "responses" : kind === "embedding" ? "embeddings" : "gitee_rerank"
				}
			/>
			<label className={labelClass}>
				超时（毫秒）
				<input
					className={inputClass}
					defaultValue={initial?.timeoutMs ?? 30_000}
					min="1"
					name="timeoutMs"
					type="number"
				/>
			</label>
			{kind === "embedding" ? (
				<label className={labelClass}>
					向量维度
					<input
						className={inputClass}
						defaultValue={initial?.dimensions ?? undefined}
						min="1"
						name="dimensions"
						required
						type="number"
					/>
				</label>
			) : null}
			<Button disabled={pending || connections.length === 0} type="submit">
				{initial ? <Pencil className="size-4" /> : <KeyRound className="size-4" />}
				{initial ? "保存配置修改" : "保存配置"}
			</Button>
		</form>
	);
}
function connectionFeatureValue(features: ProviderConfigConnectionSummary["features"]) {
	return features.includes("prompt") && features.includes("embedding")
		? "prompt_embedding"
		: (features[0] ?? "prompt_embedding");
}
function statusLabel(value: string) {
	return value === "validated" ? "已验证" : value === "validation_failed" ? "验证失败" : "草稿";
}
function formatPublicationTime(value: string | null) {
	return value
		? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(
				new Date(value),
			)
		: "时间未知";
}
