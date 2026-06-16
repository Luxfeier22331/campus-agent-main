import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Pencil, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";

import {
	activateProviderConfigProfile,
	createProviderConfigProfile,
	listProviderConfigProfiles,
	updateProviderConfigProfile,
	validateProviderConfigProfile,
} from "./api";
import type {
	ProviderConfigCreatePayload,
	ProviderConfigKind,
	ProviderConfigProfile,
	ProviderConfigRole,
	ProviderConfigUpdatePayload,
} from "./model";

const KIND_LABEL: Record<ProviderConfigKind, string> = {
	embedding: "Embedding",
	prompt: "Prompt",
};

const ROLE_LABEL: Record<ProviderConfigRole, string> = {
	index_embedding: "索引向量化",
	primary_agent: "主 Agent",
	rag_query_embedding: "RAG 查询向量化",
	rag_synthesis: "RAG 合成",
};

const STATUS_LABEL = {
	active: "已启用",
	draft: "草稿",
	validation_failed: "校验失败",
	validated: "已校验",
} as const;

const ROLE_OPTIONS: Array<{ kind: ProviderConfigKind; role: ProviderConfigRole }> = [
	{ kind: "prompt", role: "primary_agent" },
	{ kind: "prompt", role: "rag_synthesis" },
	{ kind: "embedding", role: "rag_query_embedding" },
	{ kind: "embedding", role: "index_embedding" },
];

interface ProviderConfigFormState {
	apiKey: string;
	baseUrl: string;
	dimensions: string;
	model: string;
	role: ProviderConfigRole;
	timeoutMs: string;
}

function initialProviderConfigForm(): ProviderConfigFormState {
	return {
		apiKey: "",
		baseUrl: "https://api.openai.com/v1",
		dimensions: "2560",
		model: "",
		role: "primary_agent",
		timeoutMs: "30000",
	};
}

export function ProviderConfigPage() {
	const queryClient = useQueryClient();
	const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
	const [form, setForm] = useState<ProviderConfigFormState>(initialProviderConfigForm);
	const profilesQuery = useQuery({
		queryFn: ({ signal }) => listProviderConfigProfiles({ signal }),
		queryKey: ["provider-config", "profiles"],
	});
	const invalidateProfiles = () => {
		void queryClient.invalidateQueries({ queryKey: ["provider-config", "profiles"] });
	};
	const createMutation = useMutation({
		mutationFn: createProviderConfigProfile,
		onSuccess: () => {
			setForm(initialProviderConfigForm());
			invalidateProfiles();
		},
	});
	const updateMutation = useMutation({
		mutationFn: (input: { payload: ProviderConfigUpdatePayload; profileId: string }) =>
			updateProviderConfigProfile(input.profileId, input.payload),
		onSuccess: () => {
			setEditingProfileId(null);
			setForm(initialProviderConfigForm());
			invalidateProfiles();
		},
	});
	const validateMutation = useMutation({
		mutationFn: validateProviderConfigProfile,
		onSuccess: invalidateProfiles,
	});
	const activateMutation = useMutation({
		mutationFn: activateProviderConfigProfile,
		onSuccess: invalidateProfiles,
	});
	const selectedKind = kindForRole(form.role);
	const isEditing = editingProfileId !== null;
	const missingRequiredApiKey = !(isEditing || form.apiKey.trim());

	return (
		<section className="space-y-4">
			<div className="ops-panel p-5">
				<p className="ops-eyebrow">Provider runtime</p>
				<h2 className="ops-title">Provider 配置</h2>
				<form
					className="mt-4 grid gap-3 lg:grid-cols-3"
					onSubmit={(event) => {
						event.preventDefault();
						if (editingProfileId) {
							updateMutation.mutate({
								payload: buildUpdatePayload(form),
								profileId: editingProfileId,
							});
							return;
						}
						createMutation.mutate(buildCreatePayload(form));
					}}
				>
					<label className="ops-field">
						<span>角色</span>
						<select
							disabled={isEditing}
							value={form.role}
							onChange={(event) =>
								setForm((current) => ({
									...current,
									role: event.target.value as ProviderConfigRole,
								}))
							}
						>
							{ROLE_OPTIONS.map((option) => (
								<option key={option.role} value={option.role}>
									{ROLE_LABEL[option.role]}
								</option>
							))}
						</select>
					</label>
					<label className="ops-field">
						<span>Base URL</span>
						<input
							value={form.baseUrl}
							onChange={(event) =>
								setForm((current) => ({ ...current, baseUrl: event.target.value }))
							}
						/>
					</label>
					<label className="ops-field">
						<span>Model</span>
						<input
							value={form.model}
							onChange={(event) =>
								setForm((current) => ({ ...current, model: event.target.value }))
							}
						/>
					</label>
					<label className="ops-field">
						<span>API Key</span>
						<input
							autoComplete="off"
							type="password"
							value={form.apiKey}
							placeholder={isEditing ? "留空保留现有 Key" : undefined}
							onChange={(event) =>
								setForm((current) => ({ ...current, apiKey: event.target.value }))
							}
						/>
					</label>
					<label className="ops-field">
						<span>Dimensions</span>
						<input
							disabled={selectedKind === "prompt"}
							inputMode="numeric"
							value={selectedKind === "prompt" ? "" : form.dimensions}
							onChange={(event) =>
								setForm((current) => ({ ...current, dimensions: event.target.value }))
							}
						/>
					</label>
					<label className="ops-field">
						<span>Timeout ms</span>
						<input
							inputMode="numeric"
							value={form.timeoutMs}
							onChange={(event) =>
								setForm((current) => ({ ...current, timeoutMs: event.target.value }))
							}
						/>
					</label>
					<div className="lg:col-span-3">
						<button
							className="ops-primary-button"
							disabled={
								createMutation.isPending ||
								updateMutation.isPending ||
								missingRequiredApiKey ||
								!form.model.trim()
							}
							type="submit"
						>
							<KeyRound aria-hidden="true" className="size-4" />
							{isEditing ? "保存修改" : "保存配置"}
						</button>
						{isEditing ? (
							<button
								className="ops-secondary-button ml-2"
								disabled={updateMutation.isPending}
								onClick={() => {
									setEditingProfileId(null);
									setForm(initialProviderConfigForm());
								}}
								type="button"
							>
								<XCircle aria-hidden="true" className="size-4" />
								取消编辑
							</button>
						) : null}
					</div>
				</form>
			</div>

			<section className="ops-panel overflow-hidden">
				<div className="border-slate-200 border-b p-4">
					<p className="ops-eyebrow">Profiles</p>
					<h3 className="font-bold text-slate-800">运行配置档案</h3>
				</div>
				<div className="overflow-x-auto">
					<table className="ops-table">
						<thead>
							<tr>
								<th>角色</th>
								<th>类型</th>
								<th>状态</th>
								<th>Model</th>
								<th>Endpoint</th>
								<th>Key</th>
								<th>校验</th>
								<th>操作</th>
							</tr>
						</thead>
						<tbody>
							{profilesQuery.data?.profiles.map((profile) => (
								<tr key={profile.profileId}>
									<td>{ROLE_LABEL[profile.role]}</td>
									<td>{KIND_LABEL[profile.kind]}</td>
									<td>
										<span className="inline-flex items-center gap-1">
											{profile.active ? (
												<CheckCircle2 aria-hidden="true" className="size-4 text-emerald-600" />
											) : null}
											{STATUS_LABEL[profile.status]}
										</span>
									</td>
									<td className="font-mono text-xs">{profile.model}</td>
									<td className="font-mono text-xs">{profile.baseUrl}</td>
									<td className="font-mono text-xs">****{profile.secretLast4}</td>
									<td>
										{profile.validation?.ok === true ? (
											<span className="inline-flex items-center gap-1 text-emerald-700">
												<ShieldCheck aria-hidden="true" className="size-4" />
												通过
											</span>
										) : profile.validation ? (
											<span className="inline-flex items-center gap-1 text-red-700">
												<XCircle aria-hidden="true" className="size-4" />
												{profile.validation.errorCode ?? "失败"}
											</span>
										) : (
											"未校验"
										)}
									</td>
									<td>
										<div className="flex flex-wrap gap-2">
											<button
												className="ops-secondary-button"
												disabled={profile.active || updateMutation.isPending}
												onClick={() => {
													setEditingProfileId(profile.profileId);
													setForm(formFromProfile(profile));
												}}
												type="button"
											>
												<Pencil aria-hidden="true" className="size-4" />
												编辑
											</button>
											<button
												className="ops-secondary-button"
												disabled={validateMutation.isPending}
												onClick={() => validateMutation.mutate(profile.profileId)}
												type="button"
											>
												<ShieldCheck aria-hidden="true" className="size-4" />
												校验
											</button>
											<button
												className="ops-primary-button"
												disabled={
													activateMutation.isPending ||
													profile.active ||
													profile.validation?.ok !== true
												}
												onClick={() => activateMutation.mutate(profile.profileId)}
												type="button"
											>
												<CheckCircle2 aria-hidden="true" className="size-4" />
												启用
											</button>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				{profilesQuery.data?.profiles.length === 0 ? (
					<div className="p-6 text-sm text-slate-600">暂无 Provider 配置。</div>
				) : null}
			</section>
		</section>
	);
}

function kindForRole(role: ProviderConfigRole): ProviderConfigKind {
	return role.endsWith("_embedding") ? "embedding" : "prompt";
}

function buildCreatePayload(form: {
	apiKey: string;
	baseUrl: string;
	dimensions: string;
	model: string;
	role: ProviderConfigRole;
	timeoutMs: string;
}): ProviderConfigCreatePayload {
	const kind = kindForRole(form.role);
	const payload: ProviderConfigCreatePayload = {
		apiKey: form.apiKey,
		baseUrl: form.baseUrl,
		kind,
		model: form.model,
		provider: "openai",
		role: form.role,
		timeoutMs: Number.parseInt(form.timeoutMs, 10),
		transport: kind === "embedding" ? "embeddings" : "responses",
	};
	if (kind === "embedding") {
		payload.dimensions = Number.parseInt(form.dimensions, 10);
	}
	return payload;
}

function buildUpdatePayload(form: ProviderConfigFormState): ProviderConfigUpdatePayload {
	const kind = kindForRole(form.role);
	const payload: ProviderConfigUpdatePayload = {
		baseUrl: form.baseUrl,
		model: form.model,
		timeoutMs: Number.parseInt(form.timeoutMs, 10),
		transport: kind === "embedding" ? "embeddings" : "responses",
	};
	if (form.apiKey.trim()) {
		payload.apiKey = form.apiKey;
	}
	if (kind === "embedding") {
		payload.dimensions = Number.parseInt(form.dimensions, 10);
	}
	return payload;
}

function formFromProfile(profile: ProviderConfigProfile): ProviderConfigFormState {
	return {
		apiKey: "",
		baseUrl: profile.baseUrl,
		dimensions: profile.dimensions?.toString() ?? "2560",
		model: profile.model,
		role: profile.role,
		timeoutMs: profile.timeoutMs.toString(),
	};
}
