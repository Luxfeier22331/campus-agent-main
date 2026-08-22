import {
	Button,
	Card,
	CardContent,
	CardHeader,
	CardTitle,
	cn,
	Field as FormField,
	Input,
	NativeSelect,
} from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Eye, EyeOff, RefreshCw, Save, Undo2 } from "lucide-react";
import { type FormEvent, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type {
	ExecutionModelSettingsStatus,
	ModelSettingKind,
	ModelSettingUpdate,
} from "../shared/ops-contract";
import { formatTimestamp } from "./format";
import { OpsApiError } from "./ops-api/core";
import {
	discoverExecutionModels,
	fetchExecutionModelSettings,
	putExecutionModelSetting,
} from "./ops-api/model-settings";
import { ErrorState, InlineError, PageHeader, StaleDataWarning } from "./ops-display";
import {
	executionModelSettingsQueryKey,
	InlineNotice,
	transportLabel,
	UnsavedChangesGuard,
	ValidationBadge,
	validationDetail,
} from "./provider-config-ui";

interface ExecutionDraft {
	apiKey: string;
	baseUrl: string;
	model: string;
	provider: "openai" | "openai-compatible" | "cohere" | "cohere-compatible";
	transport: "responses" | "chat_completions" | "embeddings" | "rerank";
}

export function ProviderConfigPage() {
	return (
		<section>
			<PageHeader
				description="配置在线运行时、检索重排和通知分类使用的模型连接。"
				title="模型配置"
			/>
			<ExecutionModelSettings />
		</section>
	);
}

function ExecutionModelSettings() {
	const [dirtyKinds, setDirtyKinds] = useState<Record<ModelSettingKind, boolean>>({
		embedding: false,
		llm: false,
		reranker: false,
		notice_classifier: false,
	});
	const status = useQuery({
		queryFn: ({ signal }) => fetchExecutionModelSettings({ signal }),
		queryKey: executionModelSettingsQueryKey,
	});
	const onDirtyChange = useCallback((kind: ModelSettingKind, dirty: boolean) => {
		setDirtyKinds((current) => (current[kind] === dirty ? current : { ...current, [kind]: dirty }));
	}, []);
	const dirty =
		dirtyKinds.llm || dirtyKinds.embedding || dirtyKinds.reranker || dirtyKinds.notice_classifier;

	if (status.isPending) {
		return <LoadingSettings />;
	}
	if (!status.data) {
		return (
			<ErrorState error={status.error} onRetry={() => status.refetch()} title="模型配置读取失败" />
		);
	}
	return (
		<>
			<UnsavedChangesGuard dirty={dirty} />
			{status.isError ? (
				<StaleDataWarning
					error={status.error}
					lastSuccessfulAt={status.dataUpdatedAt}
					onRetry={() => status.refetch()}
					title="模型配置刷新失败"
				/>
			) : null}
			<div className="grid gap-4 xl:grid-cols-4">
				<ExecutionModelSettingForm
					embeddingContract={status.data.embeddingContract}
					kind="llm"
					onDirtyChange={onDirtyChange}
					setting={status.data.settings.llm}
				/>
				<ExecutionModelSettingForm
					embeddingContract={status.data.embeddingContract}
					kind="embedding"
					onDirtyChange={onDirtyChange}
					setting={status.data.settings.embedding}
				/>
				<ExecutionModelSettingForm
					embeddingContract={status.data.embeddingContract}
					kind="reranker"
					onDirtyChange={onDirtyChange}
					setting={status.data.settings.reranker}
				/>
				<ExecutionModelSettingForm
					embeddingContract={status.data.embeddingContract}
					kind="notice_classifier"
					onDirtyChange={onDirtyChange}
					setting={status.data.settings.notice_classifier}
				/>
			</div>
		</>
	);
}

function ExecutionModelSettingForm({
	embeddingContract,
	kind,
	onDirtyChange,
	setting,
}: {
	embeddingContract: ExecutionModelSettingsStatus["embeddingContract"];
	kind: ModelSettingKind;
	onDirtyChange: (kind: ModelSettingKind, dirty: boolean) => void;
	setting: ExecutionModelSettingsStatus["settings"][ModelSettingKind];
}) {
	const queryClient = useQueryClient();
	const embedding = kind === "embedding";
	const reranker = kind === "reranker";
	const noticeClassifier = kind === "notice_classifier";
	const settingTitle = embedding
		? "Embedding"
		: reranker
			? "Reranker"
			: noticeClassifier
				? "通知分类"
				: "LLM";
	const settingDescription = embedding
		? "检索查询向量"
		: reranker
			? "候选文档重排"
			: noticeClassifier
				? "通知标题分类"
				: "Agent 文本生成";
	const [baseline, setBaseline] = useState<ExecutionDraft>(() =>
		executionDraftFromSetting(setting, embedding, reranker, embeddingContract),
	);
	const [draft, setDraft] = useState<ExecutionDraft>(() =>
		executionDraftFromSetting(setting, embedding, reranker, embeddingContract),
	);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [advancedOpen, setAdvancedOpen] = useState(false);
	const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
	const formRef = useRef<HTMLFormElement>(null);
	const dirty = !executionDraftEquals(draft, baseline);

	const syncFromSetting = useCallback(
		(next: typeof setting) => {
			const nextDraft = executionDraftFromSetting(next, embedding, reranker, embeddingContract);
			setBaseline(nextDraft);
			setDraft(nextDraft);
			setErrors({});
		},
		[embedding, embeddingContract, reranker],
	);

	useEffect(() => {
		onDirtyChange(kind, dirty);
	}, [dirty, kind, onDirtyChange]);

	useEffect(() => {
		const next = executionDraftFromSetting(setting, embedding, reranker, embeddingContract);
		if (executionDraftEquals(next, baseline)) {
			return;
		}
		if (dirty) {
			return;
		}
		syncFromSetting(setting);
	}, [baseline, dirty, embedding, embeddingContract, reranker, setting, syncFromSetting]);

	const save = useMutation({
		mutationFn: (payload: ModelSettingUpdate) => putExecutionModelSetting(kind, payload),
		onSuccess: (data) => {
			queryClient.setQueryData(executionModelSettingsQueryKey, data);
			syncFromSetting(data.settings[kind]);
			setSaveFeedback("配置已保存并验证通过。");
		},
	});
	const discovery = useMutation({
		mutationFn: () =>
			discoverExecutionModels(
				reranker ? "reranker" : noticeClassifier ? "notice_classifier" : "llm",
				{
					apiKey: draft.apiKey,
					baseUrl: draft.baseUrl,
					provider: draft.provider,
				},
			),
		onSuccess: () => setErrors((current) => clearErrors(current, ["model"])),
	});
	const updateDraft = (
		patch: Partial<ExecutionDraft>,
		errorKeys: string[],
		options: { keepDiscovery?: boolean } = {},
	) => {
		setDraft((current) => ({ ...current, ...patch }));
		setErrors((current) => clearErrors(current, errorKeys));
		save.reset();
		if (!options.keepDiscovery) {
			discovery.reset();
		}
		setSaveFeedback(null);
	};
	const discoverModels = () => {
		const nextErrors = validateModelDiscoveryDraft(draft, !setting?.credentialConfigured);
		setErrors((current) => ({ ...current, ...nextErrors }));
		if (Object.keys(nextErrors).length > 0) {
			focusFirstInvalid(formRef);
			return;
		}
		discovery.mutate();
	};
	const submit = (event: FormEvent) => {
		event.preventDefault();
		const nextErrors = validateExecutionDraft(draft, !setting?.credentialConfigured, embedding);
		setErrors(nextErrors);
		if (Object.keys(nextErrors).length > 0) {
			focusFirstInvalid(formRef);
			return;
		}
		save.mutate(executionDraftPayload(draft, embedding, reranker));
	};

	const credentialHelper = credentialHelperText(
		setting
			? {
					credentialConfigured: setting.credentialConfigured,
				}
			: { credentialConfigured: false },
	);
	const modelControlId = `execution-${kind}-model`;
	const modelErrorId = `${modelControlId}-error`;
	return (
		<Card>
			<CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
				<div className="min-w-0">
					<CardTitle>{settingTitle}</CardTitle>
					<p className="mt-1 text-muted-foreground text-sm">{settingDescription}</p>
				</div>
				<ValidationBadge validation={setting?.latestValidation ?? null} />
			</CardHeader>
			<CardContent>
				<form aria-busy={save.isPending} className="grid gap-4" onSubmit={submit} ref={formRef}>
					<FormField error={errors.baseUrl} label="Base URL">
						<Input
							className="min-h-11"
							onChange={(event) => updateDraft({ baseUrl: event.target.value }, ["baseUrl"])}
							placeholder="https://provider.example/v1"
							spellCheck={false}
							value={draft.baseUrl}
						/>
					</FormField>
					<SecretField
						{...(errors.apiKey ? { error: errors.apiKey } : {})}
						helper={credentialHelper}
						label={`${settingTitle} API Key`}
						onChange={(value) => updateDraft({ apiKey: value }, ["apiKey"])}
						value={draft.apiKey}
					/>
					{embedding ? (
						<dl className="grid gap-3 rounded-md border border-border p-3 text-sm sm:grid-cols-2">
							<ReadOnlySetting label="模型" value={embeddingContract.model} />
							<ReadOnlySetting label="服务商" value={providerLabel(embeddingContract.provider)} />
							<ReadOnlySetting
								label="接口类型"
								value={transportLabel(embeddingContract.transport)}
							/>
							<ReadOnlySetting label="向量维度" value={String(embeddingContract.dimensions)} />
						</dl>
					) : (
						<>
							<div className="grid gap-1.5 text-sm">
								<label className="font-medium leading-none" htmlFor={modelControlId}>
									模型
								</label>
								<div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
									{discovery.data && discovery.data.models.length > 0 ? (
										<NativeSelect
											aria-describedby={errors.model ? modelErrorId : undefined}
											aria-invalid={Boolean(errors.model)}
											className="min-h-11 min-w-0"
											id={modelControlId}
											onChange={(event) =>
												updateDraft({ model: event.target.value }, ["model"], {
													keepDiscovery: true,
												})
											}
											value={draft.model}
										>
											{draft.model && !discovery.data.models.includes(draft.model) ? (
												<option value={draft.model}>{draft.model}</option>
											) : null}
											{discovery.data.models.map((model) => (
												<option key={model} value={model}>
													{model}
												</option>
											))}
										</NativeSelect>
									) : (
										<Input
											aria-describedby={errors.model ? modelErrorId : undefined}
											aria-invalid={Boolean(errors.model)}
											className="min-h-11 min-w-0"
											id={modelControlId}
											onChange={(event) =>
												updateDraft({ model: event.target.value }, ["model"], {
													keepDiscovery: true,
												})
											}
											value={draft.model}
										/>
									)}
									<Button
										aria-label={`获取${settingTitle}模型`}
										disabled={discovery.isPending}
										onClick={discoverModels}
										type="button"
										variant="outline"
									>
										<RefreshCw className={cn("size-4", discovery.isPending && "animate-spin")} />
										{discovery.isPending ? "正在获取" : "获取模型"}
									</Button>
								</div>
								{errors.model ? (
									<div className="text-danger text-xs" id={modelErrorId}>
										{errors.model}
									</div>
								) : null}
							</div>
							{discovery.data ? (
								<p className="text-muted-foreground text-xs" role="status">
									已获取 {discovery.data.models.length} 个模型
								</p>
							) : null}
							{discovery.isError ? (
								<InlineError error={discovery.error} title="模型列表获取失败" />
							) : null}
						</>
					)}
					{embedding ? null : (
						<details
							className="border-border border-t pt-3"
							onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
							open={advancedOpen}
						>
							<summary className="flex min-h-11 cursor-pointer list-none items-center justify-between font-medium text-foreground text-sm">
								高级设置
								<ChevronDown
									className={cn("size-4 transition-transform", advancedOpen && "rotate-180")}
								/>
							</summary>
							<div className="grid gap-4 pt-3">
								<div className="grid gap-4 sm:grid-cols-2">
									<FormField label="服务商">
										<NativeSelect
											className="min-h-11"
											onChange={(event) =>
												updateDraft(
													{ provider: event.target.value as ExecutionDraft["provider"] },
													["provider"],
												)
											}
											value={draft.provider}
										>
											{reranker ? (
												<>
													<option value="cohere">Cohere</option>
													<option value="cohere-compatible">Cohere 兼容接口</option>
												</>
											) : (
												<>
													<option value="openai">OpenAI</option>
													<option value="openai-compatible">OpenAI 兼容接口</option>
												</>
											)}
										</NativeSelect>
									</FormField>
									{reranker ? (
										<FormField label="接口类型">
											<Input className="min-h-11" disabled value="Cohere Rerank API" />
										</FormField>
									) : (
										<FormField label="接口类型">
											<NativeSelect
												className="min-h-11"
												onChange={(event) =>
													updateDraft(
														{ transport: event.target.value as ExecutionDraft["transport"] },
														["transport"],
													)
												}
												value={draft.transport}
											>
												<option value="responses">Responses API</option>
												<option value="chat_completions">Chat Completions API</option>
											</NativeSelect>
										</FormField>
									)}
								</div>
							</div>
						</details>
					)}
					<div className="border-border border-t pt-3 text-muted-foreground text-sm">
						<p>{setting ? validationDetail(setting.latestValidation) : "尚未配置"}</p>
						{setting ? (
							<p className="mt-1 break-words">
								{transportLabel(embedding ? embeddingContract.transport : setting.transport)} ·{" "}
								{formatTimestamp(setting.updatedAt)} · {setting.updatedBy}
							</p>
						) : null}
					</div>
					{saveFeedback ? <InlineNotice>{saveFeedback}</InlineNotice> : null}
					{save.isError ? (
						<InlineError
							error={save.error}
							title={
								save.error instanceof OpsApiError && save.error.status === 422
									? "新配置验证未通过，当前配置未更改"
									: "保存失败"
							}
						/>
					) : null}
					<div className="grid gap-2 sm:flex sm:flex-wrap">
						<Button disabled={!dirty || save.isPending} type="submit">
							<Save className="size-4" />
							{save.isPending ? "验证并保存中" : "保存并验证"}
						</Button>
						{dirty ? (
							<Button
								onClick={() => {
									setDraft(baseline);
									setErrors({});
									save.reset();
									setSaveFeedback(null);
								}}
								variant="ghost"
							>
								<Undo2 className="size-4" />
								放弃更改
							</Button>
						) : null}
					</div>
				</form>
			</CardContent>
		</Card>
	);
}

function SecretField({
	disabled = false,
	error,
	helper,
	label,
	onChange,
	value,
}: {
	disabled?: boolean;
	error?: string;
	helper: string;
	label: string;
	onChange: (value: string) => void;
	value: string;
}) {
	const [visible, setVisible] = useState(false);
	return (
		<FormField
			action={
				<Button
					aria-label={`${visible ? "隐藏" : "显示"} ${label}`}
					disabled={disabled}
					onClick={() => setVisible((current) => !current)}
					size="icon-lg"
					title={`${visible ? "隐藏" : "显示"} ${label}`}
					variant="ghost"
				>
					{visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
				</Button>
			}
			description={helper}
			error={error}
			label={label}
		>
			<Input
				autoComplete="off"
				className="min-h-11 pr-11"
				disabled={disabled}
				onChange={(event) => onChange(event.target.value)}
				placeholder="输入新的 API Key"
				type={visible ? "text" : "password"}
				value={value}
			/>
		</FormField>
	);
}

function executionDraftFromSetting(
	setting: ExecutionModelSettingsStatus["settings"][ModelSettingKind],
	embedding: boolean,
	reranker: boolean,
	embeddingContract: ExecutionModelSettingsStatus["embeddingContract"],
): ExecutionDraft {
	return {
		apiKey: "",
		baseUrl: setting?.baseUrl ?? "",
		model: embedding ? embeddingContract.model : (setting?.model ?? ""),
		provider: embedding
			? embeddingContract.provider
			: (setting?.provider ?? (reranker ? "cohere" : "openai")),
		transport: embedding
			? embeddingContract.transport
			: (setting?.transport ?? (reranker ? "rerank" : "responses")),
	};
}

function executionDraftPayload(
	draft: ExecutionDraft,
	embedding: boolean,
	reranker: boolean,
): ModelSettingUpdate {
	if (embedding) {
		return {
			...(draft.apiKey.trim() ? { apiKey: draft.apiKey } : {}),
			baseUrl: draft.baseUrl,
		};
	}
	if (reranker) {
		return {
			...(draft.apiKey.trim() ? { apiKey: draft.apiKey } : {}),
			baseUrl: draft.baseUrl,
			model: draft.model,
			provider: draft.provider as "cohere" | "cohere-compatible",
		};
	}
	const common = {
		apiKey: draft.apiKey,
		baseUrl: draft.baseUrl,
		model: draft.model,
		provider: draft.provider as "openai" | "openai-compatible",
	};
	return { ...common, transport: draft.transport as "responses" | "chat_completions" };
}

function executionDraftEquals(left: ExecutionDraft, right: ExecutionDraft) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function credentialHelperText(input: { credentialConfigured: boolean }) {
	if (!input.credentialConfigured) {
		return "首次保存必须填写 API Key。";
	}
	return "当前密钥已配置；留空保持不变。";
}

function validateExecutionDraft(
	draft: ExecutionDraft,
	apiKeyRequired: boolean,
	embedding: boolean,
) {
	const errors: Record<string, string> = {};
	if (!validHttpUrl(draft.baseUrl)) {
		errors.baseUrl = "请输入有效的 HTTP(S) 地址。";
	}
	if (!(embedding || draft.model.trim())) {
		errors.model = "请输入模型名称。";
	}
	if (apiKeyRequired && !draft.apiKey.trim()) {
		errors.apiKey = "首次保存必须填写 API Key。";
	}
	return errors;
}

function ReadOnlySetting({ label, value }: { label: string; value: string }) {
	return (
		<div className="min-w-0">
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="mt-1 break-words font-medium text-foreground">{value}</dd>
		</div>
	);
}

function providerLabel(provider: ExecutionDraft["provider"]) {
	return (
		{
			cohere: "Cohere",
			"cohere-compatible": "Cohere 兼容接口",
			openai: "OpenAI",
			"openai-compatible": "OpenAI 兼容接口",
		} as const
	)[provider];
}

function validateModelDiscoveryDraft(draft: ExecutionDraft, apiKeyRequired: boolean) {
	const errors: Record<string, string> = {};
	if (!validHttpUrl(draft.baseUrl)) {
		errors.baseUrl = "请输入有效的 HTTP(S) 地址。";
	}
	if (apiKeyRequired && !draft.apiKey.trim()) {
		errors.apiKey = "首次获取模型必须填写 API Key。";
	}
	return errors;
}

function clearErrors(current: Record<string, string>, keys: string[]) {
	if (!keys.some((key) => current[key])) {
		return current;
	}
	const next = { ...current };
	for (const key of keys) {
		delete next[key];
	}
	return next;
}

function focusFirstInvalid(formRef: RefObject<HTMLFormElement | null>) {
	requestAnimationFrame(() => {
		formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
	});
}

function validHttpUrl(value: string) {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "https:" || parsed.protocol === "http:";
	} catch {
		return false;
	}
}

function LoadingSettings() {
	return (
		<Card>
			<CardContent aria-live="polite" className="p-6 text-muted-foreground text-sm" role="status">
				正在读取模型配置...
			</CardContent>
		</Card>
	);
}
