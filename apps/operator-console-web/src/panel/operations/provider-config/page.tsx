import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Pencil, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";
import { getPanelErrorMessage } from "../../panel-error";
import { Alert } from "../../ui/alert";
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
	embedding: "向量模型",
	prompt: "生成模型",
};

const ROLE_LABEL: Record<ProviderConfigRole, string> = {
	index_embedding: "索引构建向量化",
	primary_agent: "主问答生成",
	rag_query_embedding: "知识检索向量化",
	rag_synthesis: "知识问答生成",
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

const ROLE_ORDER = ROLE_OPTIONS.map((option) => option.role);

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
	const [formError, setFormError] = useState<string | null>(null);
	const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
	const [validatingProfileId, setValidatingProfileId] = useState<string | null>(null);
	const [activatingProfileId, setActivatingProfileId] = useState<string | null>(null);
	const profilesQuery = useQuery({
		queryFn: ({ signal }) => listProviderConfigProfiles({ signal }),
		queryKey: ["provider-config", "profiles"],
	});
	const invalidateProfiles = () => {
		void queryClient.invalidateQueries({ queryKey: ["provider-config", "profiles"] });
	};
	const createMutation = useMutation({
		mutationFn: createProviderConfigProfile,
		onError: (error) => {
			setFormError(getPanelErrorMessage(error, "保存配置失败。"));
		},
		onSuccess: () => {
			setForm(initialProviderConfigForm());
			setFormError(null);
			invalidateProfiles();
		},
	});
	const updateMutation = useMutation({
		mutationFn: (input: { payload: ProviderConfigUpdatePayload; profileId: string }) =>
			updateProviderConfigProfile(input.profileId, input.payload),
		onError: (error) => {
			setFormError(getPanelErrorMessage(error, "保存配置失败。"));
		},
		onSuccess: () => {
			setEditingProfileId(null);
			setForm(initialProviderConfigForm());
			setFormError(null);
			invalidateProfiles();
		},
	});
	const validateMutation = useMutation({
		mutationFn: validateProviderConfigProfile,
		onError: (error, profileId) => {
			setRowErrors((current) => ({
				...current,
				[profileId]: getPanelErrorMessage(error, "校验失败。"),
			}));
		},
		onSettled: () => setValidatingProfileId(null),
		onSuccess: (_result, profileId) => {
			setRowErrors((current) => omitRecordKey(current, profileId));
			invalidateProfiles();
		},
	});
	const activateMutation = useMutation({
		mutationFn: activateProviderConfigProfile,
		onError: (error, profileId) => {
			setRowErrors((current) => ({
				...current,
				[profileId]: getPanelErrorMessage(error, "启用失败。"),
			}));
		},
		onSettled: () => setActivatingProfileId(null),
		onSuccess: (_result, profileId) => {
			setRowErrors((current) => omitRecordKey(current, profileId));
			invalidateProfiles();
		},
	});
	const selectedKind = kindForRole(form.role);
	const isEditing = editingProfileId !== null;
	const missingRequiredApiKey = !(isEditing || form.apiKey.trim());
	const profiles = sortProfiles(profilesQuery.data?.profiles ?? []);

	return (
		<section className="space-y-4">
			<div className="ops-panel p-5">
				<p className="ops-eyebrow">模型服务配置</p>
				<h2 className="ops-title">OpenAI-compatible 模型端点</h2>
				<p className="mt-2 text-slate-600 text-sm">
					配置 OpenAI-compatible 生成模型和向量模型端点。
				</p>
				<form
					className="mt-4 grid gap-3 lg:grid-cols-3"
					onSubmit={(event) => {
						event.preventDefault();
						setFormError(null);
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
						<span>使用位置</span>
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
						<span>模型名称</span>
						<input
							value={form.model}
							onChange={(event) =>
								setForm((current) => ({ ...current, model: event.target.value }))
							}
						/>
					</label>
					<label className="ops-field">
						<span>服务端点</span>
						<input
							value={form.baseUrl}
							onChange={(event) =>
								setForm((current) => ({ ...current, baseUrl: event.target.value }))
							}
						/>
					</label>
					<label className="ops-field">
						<span>密钥</span>
						<input
							autoComplete="off"
							type="password"
							value={form.apiKey}
							placeholder={isEditing ? "留空保留现有密钥" : undefined}
							onChange={(event) =>
								setForm((current) => ({ ...current, apiKey: event.target.value }))
							}
						/>
					</label>
					<label className="ops-field">
						<span>超时时间</span>
						<input
							inputMode="numeric"
							value={form.timeoutMs}
							onChange={(event) =>
								setForm((current) => ({ ...current, timeoutMs: event.target.value }))
							}
						/>
					</label>
					<label className="ops-field">
						<span>向量维度</span>
						<input
							disabled={selectedKind === "prompt"}
							inputMode="numeric"
							value={selectedKind === "prompt" ? "" : form.dimensions}
							onChange={(event) =>
								setForm((current) => ({ ...current, dimensions: event.target.value }))
							}
						/>
						{selectedKind === "prompt" ? (
							<span className="mt-1 text-slate-500 text-xs">生成模型不需要向量维度</span>
						) : null}
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
									setFormError(null);
								}}
								type="button"
							>
								<XCircle aria-hidden="true" className="size-4" />
								取消编辑
							</button>
						) : null}
					</div>
					{formError ? (
						<Alert className="lg:col-span-3" tone="danger">
							{formError}
						</Alert>
					) : null}
				</form>
			</div>

			<section className="ops-panel overflow-hidden">
				<div className="border-slate-200 border-b p-4">
					<p className="ops-eyebrow">配置档案</p>
					<h3 className="font-bold text-slate-800">运行配置档案</h3>
				</div>
				<div className="overflow-x-auto">
					<table className="ops-table">
						<thead>
							<tr>
								<th>使用位置</th>
								<th>类型</th>
								<th>状态</th>
								<th>模型名称</th>
								<th>服务端点</th>
								<th>密钥</th>
								<th>校验</th>
								<th>操作</th>
							</tr>
						</thead>
						<tbody>
							{profiles.map((profile) => {
								const isValidating = validatingProfileId === profile.profileId;
								const isActivating = activatingProfileId === profile.profileId;
								return (
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
											<div className="space-y-2">
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
												{rowErrors[profile.profileId] ? (
													<Alert className="px-3 py-2" tone="danger">
														{rowErrors[profile.profileId]}
													</Alert>
												) : null}
											</div>
										</td>
										<td>
											<div className="flex flex-wrap gap-2">
												<button
													className="ops-secondary-button"
													disabled={profile.active || updateMutation.isPending}
													onClick={() => {
														setEditingProfileId(profile.profileId);
														setForm(formFromProfile(profile));
														setFormError(null);
													}}
													type="button"
												>
													<Pencil aria-hidden="true" className="size-4" />
													编辑
												</button>
												<button
													className="ops-secondary-button"
													disabled={isValidating}
													onClick={() => {
														setValidatingProfileId(profile.profileId);
														setRowErrors((current) => omitRecordKey(current, profile.profileId));
														validateMutation.mutate(profile.profileId);
													}}
													type="button"
												>
													<ShieldCheck aria-hidden="true" className="size-4" />
													{isValidating ? "校验中" : "校验"}
												</button>
												<button
													className="ops-primary-button"
													disabled={
														isActivating || profile.active || profile.validation?.ok !== true
													}
													onClick={() => {
														setActivatingProfileId(profile.profileId);
														setRowErrors((current) => omitRecordKey(current, profile.profileId));
														activateMutation.mutate(profile.profileId);
													}}
													type="button"
												>
													<CheckCircle2 aria-hidden="true" className="size-4" />
													{isActivating ? "启用中" : "启用"}
												</button>
											</div>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
				{profilesQuery.data?.profiles.length === 0 ? (
					<div className="p-6 text-sm text-slate-600">
						暂无模型服务配置，请先创建主问答生成配置。
					</div>
				) : null}
			</section>
		</section>
	);
}

function kindForRole(role: ProviderConfigRole): ProviderConfigKind {
	return role.endsWith("_embedding") ? "embedding" : "prompt";
}

function sortProfiles(profiles: ProviderConfigProfile[]) {
	return [...profiles].sort((left, right) => {
		if (left.active !== right.active) {
			return left.active ? -1 : 1;
		}
		const roleDelta = ROLE_ORDER.indexOf(left.role) - ROLE_ORDER.indexOf(right.role);
		if (roleDelta !== 0) {
			return roleDelta;
		}
		return right.updatedAt.localeCompare(left.updatedAt);
	});
}

function omitRecordKey(record: Record<string, string>, key: string): Record<string, string> {
	const { [key]: _removed, ...rest } = record;
	return rest;
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
