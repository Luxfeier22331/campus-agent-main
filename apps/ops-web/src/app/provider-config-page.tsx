import {
	Badge,
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
import { Link } from "@tanstack/react-router";
import { ChevronDown, Eye, EyeOff, RefreshCw, RotateCw, Save, Undo2 } from "lucide-react";
import { type FormEvent, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type {
	ExecutionModelSettingsStatus,
	HindsightModelSettingsStatus,
	ModelSettingKind,
	ModelSettingUpdate,
} from "../shared/ops-contract";
import { formatTimestamp } from "./format";
import {
	applyHindsightModelSettings,
	fetchExecutionModelSettings,
	fetchHindsightModelSettings,
	OpsApiError,
	putExecutionModelSetting,
	putHindsightModelSettings,
	validateExecutionModelSetting,
} from "./ops-api-client";
import { ErrorState, InlineError, KeyValue, PageHeader, StaleDataWarning } from "./ops-display";
import {
	executionModelSettingsQueryKey,
	hindsightModelSettingsQueryKey,
	InlineNotice,
	ReadOnlyFacts,
	transportLabel,
	UnsavedChangesGuard,
	ValidationBadge,
	validationDetail,
} from "./provider-config-ui";

export type ModelSettingsService = "execution" | "hindsight";

interface ExecutionDraft {
	apiKey: string;
	baseUrl: string;
	model: string;
	provider: ModelSettingUpdate["provider"];
	transport: ModelSettingUpdate["transport"];
}

interface HindsightDraft {
	embeddingApiKey: string;
	embeddingBaseUrl: string;
	llmApiKey: string;
	llmBaseUrl: string;
	llmModel: string;
}

export function ProviderConfigPage({ service }: { service: ModelSettingsService }) {
	return (
		<section>
			<PageHeader description="配置在线问答和个人记忆实际使用的模型连接。" title="模型配置" />
			<ModelSettingsTabs service={service} />
			{service === "execution" ? <ExecutionModelSettings /> : <HindsightModelSettings />}
		</section>
	);
}

function ModelSettingsTabs({ service }: { service: ModelSettingsService }) {
	return (
		<nav aria-label="模型配置服务" className="mb-5 flex overflow-x-auto border-border border-b">
			{(
				[
					["execution", "在线问答"],
					["hindsight", "个人记忆"],
				] as const
			).map(([value, label]) => (
				<Link
					aria-current={service === value ? "page" : undefined}
					className={cn(
						"min-h-11 shrink-0 border-b-2 px-4 py-3 font-medium text-sm",
						service === value
							? "border-foreground text-foreground"
							: "border-transparent text-muted-foreground hover:text-foreground",
					)}
					key={value}
					search={{ service: value }}
					to="/providers"
				>
					{label}
				</Link>
			))}
		</nav>
	);
}

function ExecutionModelSettings() {
	const [dirtyKinds, setDirtyKinds] = useState<Record<ModelSettingKind, boolean>>({
		embedding: false,
		llm: false,
	});
	const status = useQuery({
		queryFn: ({ signal }) => fetchExecutionModelSettings({ signal }),
		queryKey: executionModelSettingsQueryKey,
	});
	const onDirtyChange = useCallback((kind: ModelSettingKind, dirty: boolean) => {
		setDirtyKinds((current) => (current[kind] === dirty ? current : { ...current, [kind]: dirty }));
	}, []);
	const dirty = dirtyKinds.llm || dirtyKinds.embedding;

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
			<div className="grid gap-4 xl:grid-cols-2">
				<ExecutionModelSettingForm
					etag={status.data.etag}
					kind="llm"
					onDirtyChange={onDirtyChange}
					setting={status.data.settings.llm}
				/>
				<ExecutionModelSettingForm
					etag={status.data.etag}
					kind="embedding"
					onDirtyChange={onDirtyChange}
					setting={status.data.settings.embedding}
				/>
			</div>
		</>
	);
}

function ExecutionModelSettingForm({
	etag,
	kind,
	onDirtyChange,
	setting,
}: {
	etag: string;
	kind: ModelSettingKind;
	onDirtyChange: (kind: ModelSettingKind, dirty: boolean) => void;
	setting: ExecutionModelSettingsStatus["settings"][ModelSettingKind];
}) {
	const queryClient = useQueryClient();
	const embedding = kind === "embedding";
	const [baseline, setBaseline] = useState<ExecutionDraft>(() =>
		executionDraftFromSetting(setting, embedding),
	);
	const [draft, setDraft] = useState<ExecutionDraft>(() =>
		executionDraftFromSetting(setting, embedding),
	);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [advancedOpen, setAdvancedOpen] = useState(false);
	const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
	const [remoteChanged, setRemoteChanged] = useState(false);
	const formRef = useRef<HTMLFormElement>(null);
	const dirty = !executionDraftEquals(draft, baseline);

	const syncFromSetting = useCallback(
		(next: typeof setting) => {
			const nextDraft = executionDraftFromSetting(next, embedding);
			setBaseline(nextDraft);
			setDraft(nextDraft);
			setErrors({});
			setRemoteChanged(false);
		},
		[embedding],
	);

	useEffect(() => {
		onDirtyChange(kind, dirty);
	}, [dirty, kind, onDirtyChange]);

	useEffect(() => {
		const next = executionDraftFromSetting(setting, embedding);
		if (executionDraftEquals(next, baseline)) {
			return;
		}
		if (dirty) {
			setRemoteChanged(true);
			return;
		}
		syncFromSetting(setting);
	}, [baseline, dirty, embedding, setting, syncFromSetting]);

	const save = useMutation({
		mutationFn: (payload: ModelSettingUpdate) => putExecutionModelSetting(kind, payload, etag),
		onError: (error) => {
			if (error instanceof OpsApiError && error.status === 409) {
				setRemoteChanged(true);
			}
		},
		onSuccess: (data) => {
			queryClient.setQueryData(executionModelSettingsQueryKey, data);
			syncFromSetting(data.settings[kind]);
			setSaveFeedback("配置已保存并验证通过。");
		},
	});
	const validation = useMutation({
		mutationFn: () => validateExecutionModelSetting(kind),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: executionModelSettingsQueryKey }),
	});
	const reload = useMutation({
		mutationFn: fetchExecutionModelSettings,
		onSuccess: (data) => {
			queryClient.setQueryData(executionModelSettingsQueryKey, data);
			syncFromSetting(data.settings[kind]);
			save.reset();
			validation.reset();
			setSaveFeedback(null);
		},
	});

	const updateDraft = (patch: Partial<ExecutionDraft>, errorKeys: string[]) => {
		setDraft((current) => ({ ...current, ...patch }));
		setErrors((current) => clearErrors(current, errorKeys));
		save.reset();
		validation.reset();
		setSaveFeedback(null);
	};
	const submit = (event: FormEvent) => {
		event.preventDefault();
		const nextErrors = validateExecutionDraft(draft, !setting?.credentialConfigured);
		setErrors(nextErrors);
		if (Object.keys(nextErrors).length > 0) {
			focusFirstInvalid(formRef);
			return;
		}
		save.mutate(executionDraftPayload(draft, embedding));
	};

	const credentialHelper = credentialHelperText(setting ?? { credentialConfigured: false });
	const validationResult = validation.data?.validation;
	return (
		<Card>
			<CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
				<div className="min-w-0">
					<CardTitle>{embedding ? "Embedding" : "LLM"}</CardTitle>
					<p className="mt-1 text-muted-foreground text-sm">
						{embedding ? "检索查询向量" : "Agent 文本生成"}
					</p>
				</div>
				<ValidationBadge validation={setting?.latestValidation ?? null} />
			</CardHeader>
			<CardContent>
				<form
					aria-busy={save.isPending || validation.isPending}
					className="grid gap-4"
					onSubmit={submit}
					ref={formRef}
				>
					<FormField error={errors.baseUrl} label="Base URL">
						<Input
							className="min-h-11"
							onChange={(event) => updateDraft({ baseUrl: event.target.value }, ["baseUrl"])}
							placeholder="https://provider.example/v1"
							spellCheck={false}
							value={draft.baseUrl}
						/>
					</FormField>
					{embedding ? (
						<ReadOnlyFacts
							items={[
								{ label: "模型", value: "Qwen3-Embedding-4B" },
								{ label: "向量维度", value: "2560" },
								{ label: "服务商", value: "OpenAI 兼容接口" },
								{ label: "接口类型", value: "Embeddings API" },
							]}
						/>
					) : (
						<FormField error={errors.model} label="模型">
							<Input
								className="min-h-11"
								onChange={(event) => updateDraft({ model: event.target.value }, ["model"])}
								value={draft.model}
							/>
						</FormField>
					)}
					<SecretField
						error={errors.apiKey}
						helper={credentialHelper}
						label={`${embedding ? "Embedding" : "LLM"} API Key`}
						onChange={(value) => updateDraft({ apiKey: value }, ["apiKey"])}
						value={draft.apiKey}
					/>
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
													{ provider: event.target.value as ModelSettingUpdate["provider"] },
													["provider"],
												)
											}
											value={draft.provider}
										>
											<option value="openai">OpenAI</option>
											<option value="openai-compatible">OpenAI 兼容接口</option>
										</NativeSelect>
									</FormField>
									<FormField label="接口类型">
										<NativeSelect
											className="min-h-11"
											onChange={(event) =>
												updateDraft(
													{ transport: event.target.value as ModelSettingUpdate["transport"] },
													["transport"],
												)
											}
											value={draft.transport}
										>
											<option value="responses">Responses API</option>
											<option value="chat_completions">Chat Completions API</option>
										</NativeSelect>
									</FormField>
								</div>
							</div>
						</details>
					)}
					<div className="border-border border-t pt-3 text-muted-foreground text-sm">
						<p>{setting ? validationDetail(setting.latestValidation) : "尚未配置"}</p>
						{setting ? (
							<p className="mt-1 break-words">
								{transportLabel(setting.transport)} · {formatTimestamp(setting.updatedAt)} ·{" "}
								{setting.updatedBy}
							</p>
						) : null}
					</div>
					{remoteChanged ? (
						<div
							className="grid gap-3 rounded-md border border-warning/20 bg-warning-subtle p-3 text-warning"
							role="alert"
						>
							<p className="text-sm">服务器配置已更新。请加载最新配置后重新编辑。</p>
							<div>
								<Button
									disabled={reload.isPending}
									onClick={() => reload.mutate({})}
									variant="outline"
								>
									<RefreshCw className="size-4" />
									{reload.isPending ? "正在加载" : "加载最新配置"}
								</Button>
							</div>
						</div>
					) : null}
					{saveFeedback ? <InlineNotice>{saveFeedback}</InlineNotice> : null}
					{validationResult ? (
						<InlineNotice tone={validationResult.status === "passed" ? "success" : "warning"}>
							{validationResult.status === "passed"
								? "已保存配置验证通过。"
								: `已保存配置验证未通过：${validationDetail(validationResult)}`}
						</InlineNotice>
					) : null}
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
					{validation.isError ? <InlineError error={validation.error} title="验证失败" /> : null}
					<div className="grid gap-2 sm:flex sm:flex-wrap">
						<Button disabled={!dirty || save.isPending || remoteChanged} type="submit">
							<Save className="size-4" />
							{save.isPending ? "验证并保存中" : "保存并验证"}
						</Button>
						<Button
							disabled={!setting || dirty || validation.isPending}
							onClick={() => validation.mutate()}
							variant="outline"
						>
							<RefreshCw className="size-4" />
							{validation.isPending ? "验证中" : "重新验证"}
						</Button>
						{dirty ? (
							<Button
								onClick={() => {
									setDraft(baseline);
									setErrors({});
									save.reset();
									validation.reset();
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

function HindsightModelSettings() {
	const status = useQuery({
		queryFn: ({ signal }) => fetchHindsightModelSettings({ signal }),
		queryKey: hindsightModelSettingsQueryKey,
		refetchInterval: (query) => {
			if (query.state.data?.applyState === "applying") {
				return 3_000;
			}
			return query.state.data?.runtimeState === "scaled_down" ? 15_000 : false;
		},
	});
	if (status.isPending) {
		return <LoadingSettings />;
	}
	if (!status.data) {
		return (
			<ErrorState
				error={status.error}
				onRetry={() => status.refetch()}
				title="Hindsight 配置读取失败"
			/>
		);
	}
	return (
		<>
			{status.isError ? (
				<StaleDataWarning
					error={status.error}
					lastSuccessfulAt={status.dataUpdatedAt}
					onRetry={() => status.refetch()}
					title="Hindsight 配置刷新失败"
				/>
			) : null}
			<HindsightModelSettingsForm data={status.data} />
		</>
	);
}

function HindsightModelSettingsForm({ data }: { data: HindsightModelSettingsStatus }) {
	const queryClient = useQueryClient();
	const [baseline, setBaseline] = useState(() => hindsightDraftFromStatus(data));
	const [draft, setDraft] = useState(() => hindsightDraftFromStatus(data));
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [remoteChanged, setRemoteChanged] = useState(false);
	const formRef = useRef<HTMLFormElement>(null);
	const dirty = !hindsightDraftEquals(draft, baseline);

	const syncFromStatus = useCallback((next: HindsightModelSettingsStatus) => {
		const nextDraft = hindsightDraftFromStatus(next);
		setBaseline(nextDraft);
		setDraft(nextDraft);
		setErrors({});
		setRemoteChanged(false);
	}, []);
	useEffect(() => {
		const next = hindsightDraftFromStatus(data);
		if (hindsightDraftEquals(next, baseline)) {
			return;
		}
		if (dirty) {
			setRemoteChanged(true);
			return;
		}
		syncFromStatus(data);
	}, [baseline, data, dirty, syncFromStatus]);

	const save = useMutation({
		mutationFn: (payload: Parameters<typeof putHindsightModelSettings>[0]) =>
			putHindsightModelSettings(payload, data.etag),
		onError: (error) => {
			if (error instanceof OpsApiError && error.status === 409) {
				setRemoteChanged(true);
			}
		},
		onSuccess: (next) => {
			queryClient.setQueryData(hindsightModelSettingsQueryKey, next);
			syncFromStatus(next);
		},
	});
	const applyConfig = useMutation({
		mutationFn: applyHindsightModelSettings,
		onSuccess: (next) => {
			queryClient.setQueryData(hindsightModelSettingsQueryKey, next);
		},
	});
	const reload = useMutation({
		mutationFn: fetchHindsightModelSettings,
		onSuccess: (next) => {
			queryClient.setQueryData(hindsightModelSettingsQueryKey, next);
			syncFromStatus(next);
			save.reset();
		},
	});
	const updateDraft = (patch: Partial<HindsightDraft>, errorKeys: string[]) => {
		setDraft((current) => ({ ...current, ...patch }));
		setErrors((current) => clearErrors(current, errorKeys));
		save.reset();
	};
	const submit = (event: FormEvent) => {
		event.preventDefault();
		const nextErrors = validateHindsightDraft(draft, data);
		setErrors(nextErrors);
		if (Object.keys(nextErrors).length > 0) {
			focusFirstInvalid(formRef);
			return;
		}
		save.mutate({
			embedding: { apiKey: draft.embeddingApiKey, baseUrl: draft.embeddingBaseUrl },
			llm: { apiKey: draft.llmApiKey, baseUrl: draft.llmBaseUrl, model: draft.llmModel },
		});
	};

	const canApply = !dirty && (data.applyState === "pending" || data.applyState === "failed");
	const repairingDrift = data.configState === "drifted";
	const missing = hindsightMissingFields(data);
	return (
		<>
			<UnsavedChangesGuard dirty={dirty} />
			<div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.55fr)]">
				<Card className="order-2 xl:order-1">
					<CardHeader>
						<CardTitle>Hindsight 模型连接</CardTitle>
					</CardHeader>
					<CardContent>
						<form
							aria-busy={save.isPending || applyConfig.isPending}
							className="grid gap-5"
							onSubmit={submit}
							ref={formRef}
						>
							<fieldset className="grid gap-4">
								<legend className="mb-3 font-semibold text-foreground">LLM</legend>
								<ReadOnlyFacts items={[{ label: "服务商", value: "OpenAI" }]} />
								<FormField error={errors.llmBaseUrl} label="Base URL">
									<Input
										className="min-h-11"
										onChange={(event) =>
											updateDraft({ llmBaseUrl: event.target.value }, ["llmBaseUrl"])
										}
										placeholder="https://provider.example/v1"
										spellCheck={false}
										value={draft.llmBaseUrl}
									/>
								</FormField>
								<FormField error={errors.llmModel} label="模型">
									<Input
										className="min-h-11"
										onChange={(event) =>
											updateDraft({ llmModel: event.target.value }, ["llmModel"])
										}
										value={draft.llmModel}
									/>
								</FormField>
								<SecretField
									error={errors.llmApiKey}
									helper={credentialHelperText(data.llm)}
									label="LLM API Key"
									onChange={(value) => updateDraft({ llmApiKey: value }, ["llmApiKey"])}
									value={draft.llmApiKey}
								/>
							</fieldset>
							<fieldset className="grid gap-4 border-border border-t pt-5">
								<legend className="mb-3 font-semibold text-foreground">Embedding</legend>
								<ReadOnlyFacts
									items={[
										{ label: "模型", value: "Qwen3-Embedding-4B" },
										{ label: "向量维度", value: "2560" },
										{ label: "Rerank", value: "RRF" },
									]}
								/>
								<FormField error={errors.embeddingBaseUrl} label="Base URL">
									<Input
										className="min-h-11"
										onChange={(event) =>
											updateDraft({ embeddingBaseUrl: event.target.value }, ["embeddingBaseUrl"])
										}
										placeholder="https://provider.example/v1"
										spellCheck={false}
										value={draft.embeddingBaseUrl}
									/>
								</FormField>
								<SecretField
									error={errors.embeddingApiKey}
									helper={credentialHelperText(data.embedding)}
									label="Embedding API Key"
									onChange={(value) => updateDraft({ embeddingApiKey: value }, ["embeddingApiKey"])}
									value={draft.embeddingApiKey}
								/>
							</fieldset>
							{remoteChanged ? (
								<div
									className="grid gap-3 rounded-md border border-warning/20 bg-warning-subtle p-3 text-warning"
									role="alert"
								>
									<p className="text-sm">服务器配置已更新。请加载最新配置后重新编辑。</p>
									<div>
										<Button
											disabled={reload.isPending}
											onClick={() => reload.mutate({})}
											variant="outline"
										>
											<RefreshCw className="size-4" />
											{reload.isPending ? "正在加载" : "加载最新配置"}
										</Button>
									</div>
								</div>
							) : null}
							{data.applyState === "pending" && !dirty ? (
								<InlineNotice tone="warning">
									{data.runtimeState === "scaled_down"
										? "配置已保存，服务当前未运行。请应用到下次启动。"
										: "配置已保存，运行中的实例仍使用旧配置。请应用配置。"}
								</InlineNotice>
							) : null}
							{data.applyState === "failed" && data.failure ? (
								<div
									className="rounded-md border border-danger/20 bg-danger-subtle p-3 text-danger"
									role="alert"
								>
									<p className="font-medium text-sm">Hindsight 配置应用失败</p>
									<p className="mt-1 break-words text-xs">
										{data.failure.message ?? rolloutFailureLabel(data.failure.reasonCode)}
									</p>
								</div>
							) : null}
							{save.isError ? <InlineError error={save.error} title="保存失败" /> : null}
							{applyConfig.isError ? (
								<InlineError error={applyConfig.error} title="应用失败" />
							) : null}
							<div className="grid gap-2 sm:flex sm:flex-wrap">
								<Button
									disabled={
										!(dirty || repairingDrift) ||
										save.isPending ||
										remoteChanged ||
										data.applyState === "applying"
									}
									type="submit"
								>
									<Save className="size-4" />
									{save.isPending
										? repairingDrift
											? "修复中"
											: "保存中"
										: repairingDrift
											? "修复固定配置"
											: "保存配置"}
								</Button>
								{canApply ? (
									<Button disabled={applyConfig.isPending} onClick={() => applyConfig.mutate()}>
										<RotateCw className="size-4" />
										{applyConfig.isPending
											? "正在应用"
											: data.applyState === "failed"
												? "重试应用"
												: data.runtimeState === "scaled_down"
													? "应用到下次启动"
													: "应用配置"}
									</Button>
								) : null}
								{data.applyState === "applying" ? (
									<Button disabled>
										<RotateCw className="size-4 animate-spin" />
										正在应用
									</Button>
								) : null}
								{dirty ? (
									<Button
										onClick={() => {
											setDraft(baseline);
											setErrors({});
											save.reset();
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

				<Card className="order-1 xl:order-2">
					<CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
						<CardTitle>服务状态</CardTitle>
						<HindsightStateBadge status={data} />
					</CardHeader>
					<CardContent>
						<KeyValue
							label="部署目标"
							value={data.runtimeState === "scaled_down" ? "停止" : "运行"}
						/>
						<KeyValue label="配置应用" value={hindsightApplyStateLabel(data)} />
						<KeyValue label="LLM" value={data.llm.model ?? "未配置"} />
						<KeyValue label="Embedding" value="Qwen3-Embedding-4B · 2560 维" />
						<KeyValue label="Rerank" value="RRF" />
						<KeyValue
							label="最近更新"
							value={data.updatedAt ? formatTimestamp(data.updatedAt) : "暂无记录"}
						/>
						<KeyValue label="更新人" value={data.updatedBy ?? "暂无记录"} />
						{missing.length > 0 ? (
							<div className="mt-4 rounded-md border border-warning/20 bg-warning-subtle p-3 text-warning">
								<p className="font-medium text-sm">缺少配置</p>
								<p className="mt-1 text-xs">{missing.join("、")}</p>
							</div>
						) : null}
						{data.configState === "drifted" ? (
							<InlineNotice tone="warning">
								固定模型配置与服务合同不一致。请修复固定配置后再应用。
							</InlineNotice>
						) : null}
					</CardContent>
				</Card>
			</div>
		</>
	);
}

function SecretField({
	error,
	helper,
	label,
	onChange,
	value,
}: {
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
				onChange={(event) => onChange(event.target.value)}
				placeholder="输入新的 API Key"
				type={visible ? "text" : "password"}
				value={value}
			/>
		</FormField>
	);
}

function HindsightStateBadge({ status }: { status: HindsightModelSettingsStatus }) {
	if (status.configState === "unconfigured") {
		return <Badge tone="neutral">配置不完整</Badge>;
	}
	if (status.configState === "drifted") {
		return <Badge tone="danger">配置不符合合同</Badge>;
	}
	if (status.runtimeState === "scaled_down") {
		return <Badge tone="warning">服务未运行</Badge>;
	}
	const labels = {
		applied: "配置已生效",
		applying: "正在应用",
		blocked: "暂不可应用",
		failed: "应用失败",
		pending: "待应用",
	} as const;
	const tones = {
		applied: "success",
		applying: "warning",
		blocked: "neutral",
		failed: "danger",
		pending: "warning",
	} as const;
	return <Badge tone={tones[status.applyState]}>{labels[status.applyState]}</Badge>;
}

function hindsightApplyStateLabel(status: HindsightModelSettingsStatus) {
	return {
		applied: status.runtimeState === "scaled_down" ? "已为下次启动准备" : "已生效",
		applying: "正在更新运行实例",
		blocked: "需先修复配置",
		failed: "上次应用失败",
		pending: "有保存的配置尚未应用",
	}[status.applyState];
}

function executionDraftFromSetting(
	setting: ExecutionModelSettingsStatus["settings"][ModelSettingKind],
	embedding: boolean,
): ExecutionDraft {
	return {
		apiKey: "",
		baseUrl: setting?.baseUrl ?? "",
		model: embedding ? "Qwen3-Embedding-4B" : (setting?.model ?? ""),
		provider: embedding ? "openai-compatible" : (setting?.provider ?? "openai"),
		transport: embedding ? "embeddings" : (setting?.transport ?? "responses"),
	};
}

function executionDraftPayload(draft: ExecutionDraft, embedding: boolean): ModelSettingUpdate {
	return {
		apiKey: draft.apiKey,
		baseUrl: draft.baseUrl,
		model: embedding ? "Qwen3-Embedding-4B" : draft.model,
		provider: embedding ? "openai-compatible" : draft.provider,
		transport: embedding ? "embeddings" : draft.transport,
	};
}

function executionDraftEquals(left: ExecutionDraft, right: ExecutionDraft) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function hindsightDraftFromStatus(status: HindsightModelSettingsStatus): HindsightDraft {
	return {
		embeddingApiKey: "",
		embeddingBaseUrl: status.embedding.baseUrl ?? "",
		llmApiKey: "",
		llmBaseUrl: status.llm.baseUrl ?? "",
		llmModel: status.llm.model ?? "",
	};
}

function hindsightDraftEquals(left: HindsightDraft, right: HindsightDraft) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function credentialHelperText(input: {
	credentialConfigured: boolean;
	credentialLast4?: string | null;
}) {
	if (!input.credentialConfigured) {
		return "首次保存必须填写 API Key。";
	}
	const suffix = input.credentialLast4 ? `末尾 ${input.credentialLast4}；` : "";
	return `当前密钥${suffix}留空保持不变。`;
}

function validateExecutionDraft(draft: ExecutionDraft, apiKeyRequired: boolean) {
	const errors: Record<string, string> = {};
	if (!validHttpUrl(draft.baseUrl)) {
		errors.baseUrl = "请输入有效的 HTTP(S) 地址。";
	}
	if (!draft.model.trim()) {
		errors.model = "请输入模型名称。";
	}
	if (apiKeyRequired && !draft.apiKey.trim()) {
		errors.apiKey = "首次保存必须填写 API Key。";
	}
	return errors;
}

function validateHindsightDraft(draft: HindsightDraft, status: HindsightModelSettingsStatus) {
	const errors: Record<string, string> = {};
	if (!validHttpUrl(draft.llmBaseUrl)) {
		errors.llmBaseUrl = "请输入有效的 HTTP(S) 地址。";
	}
	if (!validHttpUrl(draft.embeddingBaseUrl)) {
		errors.embeddingBaseUrl = "请输入有效的 HTTP(S) 地址。";
	}
	if (!draft.llmModel.trim()) {
		errors.llmModel = "请输入模型名称。";
	}
	if (!(status.llm.credentialConfigured || draft.llmApiKey.trim())) {
		errors.llmApiKey = "首次保存必须填写 API Key。";
	}
	if (!(status.embedding.credentialConfigured || draft.embeddingApiKey.trim())) {
		errors.embeddingApiKey = "首次保存必须填写 API Key。";
	}
	return errors;
}

function hindsightMissingFields(status: HindsightModelSettingsStatus) {
	return [
		[status.llm.baseUrl, "LLM Base URL"],
		[status.llm.model, "LLM 模型"],
		[status.llm.credentialConfigured, "LLM API Key"],
		[status.embedding.baseUrl, "Embedding Base URL"],
		[status.embedding.credentialConfigured, "Embedding API Key"],
	]
		.filter(([configured]) => !configured)
		.map(([, label]) => String(label));
}

function rolloutFailureLabel(
	reasonCode: NonNullable<HindsightModelSettingsStatus["failure"]>["reasonCode"],
) {
	return reasonCode === "HINDSIGHT_REPLICA_FAILURE"
		? "Deployment 无法创建可用副本。"
		: "Deployment rollout 未能完成。";
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
