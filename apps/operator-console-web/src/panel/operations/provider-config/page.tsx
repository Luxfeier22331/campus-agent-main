import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Pencil, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { getPanelErrorMessage } from "../../panel-error";
import { Alert } from "../../ui/alert";
import { Button } from "../../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/card";
import { Empty, EmptyDescription, EmptyTitle } from "../../ui/empty";
import { Field, FieldError, FieldLabel } from "../../ui/field";
import { Input } from "../../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import { Skeleton } from "../../ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableContainer,
	TableHead,
	TableHeader,
	TableRow,
} from "../../ui/table";
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
	ProviderConfigTransport,
	ProviderConfigUpdatePayload,
} from "./model";

const KIND_LABEL: Record<ProviderConfigKind, string> = {
	embedding: "向量模型",
	prompt: "生成模型",
};

const ROLE_LABEL: Record<ProviderConfigRole, string> = {
	eval_judge_llm: "评测裁判生成",
	eval_ragas_embedding: "RAGAS 评测向量化",
	eval_ragas_llm: "RAGAS 评测生成",
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

const TRANSPORT_LABEL: Record<ProviderConfigTransport, string> = {
	chat_completions: "Chat Completions",
	embeddings: "Embeddings",
	responses: "Responses",
};

const ROLE_OPTIONS: Array<{ kind: ProviderConfigKind; role: ProviderConfigRole }> = [
	{ kind: "prompt", role: "primary_agent" },
	{ kind: "prompt", role: "rag_synthesis" },
	{ kind: "prompt", role: "eval_ragas_llm" },
	{ kind: "prompt", role: "eval_judge_llm" },
	{ kind: "embedding", role: "rag_query_embedding" },
	{ kind: "embedding", role: "index_embedding" },
	{ kind: "embedding", role: "eval_ragas_embedding" },
];

const ROLE_ORDER = ROLE_OPTIONS.map((option) => option.role);

interface ProviderConfigFormState {
	apiKey: string;
	baseUrl: string;
	dimensions: string;
	model: string;
	role: ProviderConfigRole;
	timeoutMs: string;
	transport: ProviderConfigTransport;
}

const providerConfigFormSchema = z.object({
	apiKey: z.string(),
	baseUrl: z.string().url("请输入有效的服务端点。"),
	dimensions: z.string().regex(/^\d+$/, "请输入数字。"),
	model: z.string().min(1, "请输入模型名称。"),
	role: z.enum([
		"primary_agent",
		"rag_synthesis",
		"eval_ragas_llm",
		"eval_judge_llm",
		"rag_query_embedding",
		"index_embedding",
		"eval_ragas_embedding",
	]),
	timeoutMs: z.string().regex(/^\d+$/, "请输入数字。"),
	transport: z.enum(["responses", "chat_completions", "embeddings"]),
});

function initialProviderConfigForm(): ProviderConfigFormState {
	return {
		apiKey: "",
		baseUrl: "https://api.openai.com/v1",
		dimensions: "2560",
		model: "",
		role: "primary_agent",
		timeoutMs: "30000",
		transport: "responses",
	};
}

export function ProviderConfigPage() {
	const queryClient = useQueryClient();
	const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
	const [formError, setFormError] = useState<string | null>(null);
	const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
	const [validatingProfileId, setValidatingProfileId] = useState<string | null>(null);
	const [activatingProfileId, setActivatingProfileId] = useState<string | null>(null);
	const form = useForm<ProviderConfigFormState>({
		defaultValues: initialProviderConfigForm(),
		resolver: zodResolver(providerConfigFormSchema),
	});
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
			form.reset(initialProviderConfigForm());
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
			form.reset(initialProviderConfigForm());
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
	const selectedRole = form.watch("role");
	const selectedKind = kindForRole(selectedRole);
	const selectedTransport = form.watch("transport");
	const isEditing = editingProfileId !== null;
	const missingRequiredApiKey = !(isEditing || form.watch("apiKey").trim());
	const profiles = sortProfiles(profilesQuery.data?.profiles ?? []);

	return (
		<section className="space-y-4">
			<Card>
				<CardHeader>
					<p className="font-semibold text-slate-500 text-xs uppercase">模型服务配置</p>
					<CardTitle>OpenAI-compatible 模型端点</CardTitle>
					<CardDescription>配置 OpenAI-compatible 生成模型和向量模型端点。</CardDescription>
				</CardHeader>
				<CardContent>
					<form
						className="grid gap-3 lg:grid-cols-3"
						onSubmit={form.handleSubmit((values) => {
							setFormError(null);
							if (editingProfileId) {
								updateMutation.mutate({
									payload: buildUpdatePayload(values),
									profileId: editingProfileId,
								});
								return;
							}
							createMutation.mutate(buildCreatePayload(values));
						})}
					>
						<Controller
							control={form.control}
							name="role"
							render={({ field }) => (
								<Field>
									<FieldLabel htmlFor="provider-role">使用位置</FieldLabel>
									<Select
										disabled={isEditing}
										onValueChange={(value) => {
											field.onChange(value);
											form.setValue(
												"transport",
												kindForRole(value as ProviderConfigRole) === "embedding"
													? "embeddings"
													: "responses",
											);
										}}
										value={field.value}
									>
										<SelectTrigger id="provider-role">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{ROLE_OPTIONS.map((option) => (
												<SelectItem key={option.role} value={option.role}>
													{ROLE_LABEL[option.role]}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</Field>
							)}
						/>
						<Field>
							<FieldLabel htmlFor="provider-model">模型名称</FieldLabel>
							<Input id="provider-model" {...form.register("model")} />
							{form.formState.errors.model ? (
								<FieldError>{form.formState.errors.model.message}</FieldError>
							) : null}
						</Field>
						<Field>
							<FieldLabel htmlFor="provider-base-url">服务端点</FieldLabel>
							<Input id="provider-base-url" {...form.register("baseUrl")} />
							{form.formState.errors.baseUrl ? (
								<FieldError>{form.formState.errors.baseUrl.message}</FieldError>
							) : null}
						</Field>
						<Field>
							<FieldLabel htmlFor="provider-api-key">密钥</FieldLabel>
							<Input
								autoComplete="off"
								id="provider-api-key"
								placeholder={isEditing ? "留空保留现有密钥" : undefined}
								type="password"
								{...form.register("apiKey")}
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="provider-timeout">超时时间</FieldLabel>
							<Input id="provider-timeout" inputMode="numeric" {...form.register("timeoutMs")} />
							{form.formState.errors.timeoutMs ? (
								<FieldError>{form.formState.errors.timeoutMs.message}</FieldError>
							) : null}
						</Field>
						<Controller
							control={form.control}
							name="transport"
							render={({ field }) => (
								<Field>
									<FieldLabel htmlFor="provider-transport">接口协议</FieldLabel>
									<Select
										disabled={selectedKind === "embedding"}
										onValueChange={field.onChange}
										value={selectedKind === "embedding" ? "embeddings" : selectedTransport}
									>
										<SelectTrigger id="provider-transport">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="responses">Responses</SelectItem>
											<SelectItem value="chat_completions">Chat Completions</SelectItem>
											{selectedKind === "embedding" ? (
												<SelectItem value="embeddings">Embeddings</SelectItem>
											) : null}
										</SelectContent>
									</Select>
								</Field>
							)}
						/>
						<Field>
							<FieldLabel htmlFor="provider-dimensions">向量维度</FieldLabel>
							<Input
								disabled={selectedKind === "prompt"}
								id="provider-dimensions"
								inputMode="numeric"
								{...form.register("dimensions")}
								value={selectedKind === "prompt" ? "" : form.watch("dimensions")}
							/>
							{selectedKind === "prompt" ? (
								<span className="mt-1 text-slate-500 text-xs">生成模型不需要向量维度</span>
							) : null}
							{selectedKind === "embedding" && form.formState.errors.dimensions ? (
								<FieldError>{form.formState.errors.dimensions.message}</FieldError>
							) : null}
						</Field>
						<div className="lg:col-span-3">
							<Button
								disabled={
									createMutation.isPending ||
									updateMutation.isPending ||
									missingRequiredApiKey ||
									!form.watch("model").trim()
								}
								type="submit"
								variant="primary"
							>
								<KeyRound aria-hidden="true" className="size-4" />
								{isEditing ? "保存修改" : "保存配置"}
							</Button>
							{isEditing ? (
								<Button
									className="ml-2"
									disabled={updateMutation.isPending}
									onClick={() => {
										setEditingProfileId(null);
										form.reset(initialProviderConfigForm());
										setFormError(null);
									}}
									type="button"
									variant="secondary"
								>
									<XCircle aria-hidden="true" className="size-4" />
									取消编辑
								</Button>
							) : null}
						</div>
						{formError ? (
							<Alert className="lg:col-span-3" tone="danger">
								{formError}
							</Alert>
						) : null}
					</form>
				</CardContent>
			</Card>

			<Card className="overflow-hidden">
				<CardHeader>
					<p className="font-semibold text-slate-500 text-xs uppercase">配置档案</p>
					<CardTitle>运行配置档案</CardTitle>
				</CardHeader>
				<CardContent className="p-0">
					{profilesQuery.isLoading ? (
						<div className="space-y-2 p-5">
							<Skeleton className="h-9 w-full" />
							<Skeleton className="h-9 w-full" />
							<Skeleton className="h-9 w-full" />
						</div>
					) : null}
					{profilesQuery.error ? (
						<div className="p-5">
							<Alert tone="danger">
								{getPanelErrorMessage(profilesQuery.error, "配置列表读取失败。")}
							</Alert>
						</div>
					) : null}
					<TableContainer className="rounded-none border-0 border-t">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>使用位置</TableHead>
									<TableHead>类型</TableHead>
									<TableHead>状态</TableHead>
									<TableHead>接口协议</TableHead>
									<TableHead>模型名称</TableHead>
									<TableHead>服务端点</TableHead>
									<TableHead>密钥</TableHead>
									<TableHead>校验</TableHead>
									<TableHead>操作</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{profiles.map((profile) => {
									const isValidating = validatingProfileId === profile.profileId;
									const isActivating = activatingProfileId === profile.profileId;
									return (
										<TableRow key={profile.profileId}>
											<TableCell>{ROLE_LABEL[profile.role]}</TableCell>
											<TableCell>{KIND_LABEL[profile.kind]}</TableCell>
											<TableCell>
												<span className="inline-flex items-center gap-1">
													{profile.active ? (
														<CheckCircle2 aria-hidden="true" className="size-4 text-emerald-600" />
													) : null}
													{STATUS_LABEL[profile.status]}
												</span>
											</TableCell>
											<TableCell>{transportLabel(profile.transport)}</TableCell>
											<TableCell className="font-mono text-xs">{profile.model}</TableCell>
											<TableCell className="font-mono text-xs">{profile.baseUrl}</TableCell>
											<TableCell className="font-mono text-xs">****{profile.secretLast4}</TableCell>
											<TableCell>
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
											</TableCell>
											<TableCell>
												<div className="flex flex-wrap gap-2">
													<Button
														disabled={profile.active || updateMutation.isPending}
														onClick={() => {
															setEditingProfileId(profile.profileId);
															form.reset(formFromProfile(profile));
															setFormError(null);
														}}
														size="sm"
														type="button"
														variant="secondary"
													>
														<Pencil aria-hidden="true" className="size-4" />
														编辑
													</Button>
													<Button
														disabled={isValidating}
														onClick={() => {
															setValidatingProfileId(profile.profileId);
															setRowErrors((current) => omitRecordKey(current, profile.profileId));
															validateMutation.mutate(profile.profileId);
														}}
														size="sm"
														type="button"
														variant="secondary"
													>
														<ShieldCheck aria-hidden="true" className="size-4" />
														{isValidating ? "校验中" : "校验"}
													</Button>
													<Button
														disabled={
															isActivating || profile.active || profile.validation?.ok !== true
														}
														onClick={() => {
															setActivatingProfileId(profile.profileId);
															setRowErrors((current) => omitRecordKey(current, profile.profileId));
															activateMutation.mutate(profile.profileId);
														}}
														size="sm"
														type="button"
														variant="primary"
													>
														<CheckCircle2 aria-hidden="true" className="size-4" />
														{isActivating ? "启用中" : "启用"}
													</Button>
												</div>
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					</TableContainer>
					{profilesQuery.data?.profiles.length === 0 ? (
						<Empty className="m-5">
							<EmptyTitle>暂无模型服务配置</EmptyTitle>
							<EmptyDescription>请先创建主问答生成配置。</EmptyDescription>
						</Empty>
					) : null}
				</CardContent>
			</Card>
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
	transport: ProviderConfigTransport;
}): ProviderConfigCreatePayload {
	const kind = kindForRole(form.role);
	const payload: ProviderConfigCreatePayload = {
		apiKey: form.apiKey,
		baseUrl: form.baseUrl,
		kind,
		model: form.model,
		provider: providerForBaseUrl(form.baseUrl),
		role: form.role,
		timeoutMs: Number.parseInt(form.timeoutMs, 10),
		transport: kind === "embedding" ? "embeddings" : form.transport,
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
		transport: kind === "embedding" ? "embeddings" : form.transport,
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
		transport: normalizeTransport(profile.transport, profile.kind),
	};
}

function transportLabel(value: string): string {
	return TRANSPORT_LABEL[
		normalizeTransport(value, value === "embeddings" ? "embedding" : "prompt")
	];
}

function normalizeTransport(value: string, kind: ProviderConfigKind): ProviderConfigTransport {
	if (kind === "embedding") {
		return "embeddings";
	}
	return value === "chat_completions" ? "chat_completions" : "responses";
}

function providerForBaseUrl(baseUrl: string): ProviderConfigCreatePayload["provider"] {
	return new URL(baseUrl).hostname === "api.openai.com" ? "openai" : "openai-compatible";
}
