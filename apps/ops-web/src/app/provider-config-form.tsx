import {
	ActionGroup,
	Button,
	Card,
	CardContent,
	CardHeader,
	CardTitle,
	cn,
	Disclosure,
	DisclosureSummary,
	Field as FormField,
	Input,
	StateMessage,
} from "@campus-agent/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, RefreshCw, Save, Undo2 } from "lucide-react";
import { type FormEvent, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { ExecutionModelSettingsStatus, ModelSettingKind } from "../shared/ops-contract";
import { formatTimestamp } from "./format";
import { OpsApiError } from "./ops-api/core";
import {
	discoverExecutionModels,
	putExecutionModelSetting,
	validateExecutionModelSetting,
} from "./ops-api/model-settings";
import { InlineError } from "./ops-display";
import {
	clearErrors,
	credentialHelperText,
	type ExecutionDraft,
	executionDraftEquals,
	executionDraftFromSetting,
	executionDraftPayload,
	providerLabel,
	validateExecutionDraft,
	validateModelDiscoveryDraft,
} from "./provider-config-model";
import {
	executionModelSettingsQueryKey,
	InlineNotice,
	transportLabel,
	ValidationBadge,
	validationDetail,
} from "./provider-config-ui";
import { FilterSelect } from "./ui/filter-select";

export function ExecutionModelSettingForm({
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
		mutationFn: (payload: Parameters<typeof putExecutionModelSetting>[1]) =>
			putExecutionModelSetting(kind, payload),
		onSuccess: (data) => {
			queryClient.setQueryData(executionModelSettingsQueryKey, data);
			syncFromSetting(data.settings[kind]);
			setSaveFeedback("配置已保存并验证通过。");
		},
	});
	const revalidate = useMutation({
		mutationFn: () => validateExecutionModelSetting(kind),
		onSettled: () =>
			queryClient.invalidateQueries({ exact: true, queryKey: executionModelSettingsQueryKey }),
		onSuccess: (data) => {
			queryClient.setQueryData(executionModelSettingsQueryKey, data);
			syncFromSetting(data.settings[kind]);
			setSaveFeedback("当前配置已重新验证。");
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
		revalidate.reset();
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
		revalidate.reset();
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
	return (
		<Card>
			<CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
				<div className="min-w-0">
					<CardTitle asChild>
						<h3>{settingTitle}</h3>
					</CardTitle>
					<p className="mt-1 text-muted-foreground text-sm">{settingDescription}</p>
				</div>
				<ValidationBadge validation={setting?.latestValidation ?? null} />
			</CardHeader>
			<CardContent>
				<form
					aria-busy={save.isPending || revalidate.isPending}
					className="grid gap-4"
					onSubmit={submit}
					ref={formRef}
				>
					<fieldset
						disabled={save.isPending || revalidate.isPending}
						className="grid min-w-0 gap-4"
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
								<div className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
									<FormField label="模型" id={modelControlId} error={errors.model}>
										{discovery.data && discovery.data.models.length > 0 ? (
											<FilterSelect
												aria-invalid={Boolean(errors.model)}
												className="min-h-11 min-w-0"
												id={modelControlId}
												onValueChange={(nextValue) =>
													updateDraft({ model: nextValue }, ["model"], {
														keepDiscovery: true,
													})
												}
												value={draft.model}
												options={[
													...(draft.model && !discovery.data.models.includes(draft.model)
														? [{ value: draft.model, label: draft.model }]
														: []),
													...discovery.data.models.map((model) => ({
														value: model,
														label: model,
													})),
												]}
											/>
										) : (
											<Input
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
									</FormField>
									<Button
										aria-label={`获取${settingTitle}模型`}
										disabled={discovery.isPending}
										onClick={discoverModels}
										type="button"
										variant="secondary"
									>
										<RefreshCw className={cn("size-4", discovery.isPending && "animate-spin")} />
										{discovery.isPending ? "正在获取" : "获取模型"}
									</Button>
								</div>
								{discovery.data ? (
									<StateMessage
										layout="inline"
										role="status"
										description={<>已获取 {discovery.data.models.length} 个模型</>}
									/>
								) : null}
								{discovery.isError ? (
									<InlineError error={discovery.error} title="模型列表获取失败" />
								) : null}
							</>
						)}
						{embedding ? null : (
							<Disclosure
								className="border-border border-t pt-3"
								onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
								open={advancedOpen}
							>
								<DisclosureSummary className="font-medium text-foreground text-sm">
									高级设置
								</DisclosureSummary>
								<div className="grid gap-4 pt-3">
									<div className="grid gap-4 sm:grid-cols-2">
										<FormField label="服务商">
											<FilterSelect
												className="min-h-11"
												onValueChange={(nextValue) =>
													updateDraft(
														{
															provider: nextValue as ExecutionDraft["provider"],
															transport:
																nextValue === "google"
																	? "generate_content"
																	: draft.transport === "generate_content"
																		? "responses"
																		: draft.transport,
														},
														["provider"],
													)
												}
												value={draft.provider}
												options={
													reranker
														? [
																{ value: "cohere", label: "Cohere" },
																{
																	value: "cohere-compatible",
																	label: "Cohere 兼容接口",
																},
															]
														: [
																...(kind === "llm"
																	? [
																			{
																				value: "google",
																				label: "Gemini（原生 API）",
																			},
																		]
																	: []),
																{ value: "openai", label: "OpenAI" },
																{
																	value: "openai-compatible",
																	label: "OpenAI 兼容接口",
																},
															]
												}
											/>
										</FormField>
										{reranker ? (
											<FormField label="接口类型">
												<Input className="min-h-11" disabled value="Cohere Rerank API" />
											</FormField>
										) : (
											<FormField label="接口类型">
												<FilterSelect
													className="min-h-11"
													onValueChange={(nextValue) =>
														updateDraft(
															{
																transport: nextValue as ExecutionDraft["transport"],
															},
															["transport"],
														)
													}
													value={draft.transport}
													options={[
														...(draft.provider === "google"
															? [
																	{
																		value: "generate_content",
																		label: "Gemini GenerateContent",
																	},
																]
															: []),
														{
															value: "responses",
															label: "Responses API",
															disabled: draft.provider === "google",
														},
														{
															value: "chat_completions",
															label: "Chat Completions API",
															disabled: draft.provider === "google",
														},
													]}
												/>
											</FormField>
										)}
									</div>
								</div>
							</Disclosure>
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
						{revalidate.isError ? (
							<InlineError error={revalidate.error} title="重新验证失败" />
						) : null}
						<ActionGroup className="grid sm:flex sm:flex-wrap">
							<Button disabled={!dirty || save.isPending} type="submit">
								<Save className="size-4" />
								{save.isPending ? "验证并保存中" : "保存并验证"}
							</Button>
							{setting && !dirty ? (
								<Button
									disabled={save.isPending || revalidate.isPending}
									onClick={() => {
										setSaveFeedback(null);
										revalidate.mutate();
									}}
									type="button"
									variant="secondary"
								>
									<RefreshCw className={cn("size-4", revalidate.isPending && "animate-spin")} />
									{revalidate.isPending ? "重新验证中" : "重新验证"}
								</Button>
							) : null}
							{dirty ? (
								<Button
									onClick={() => {
										setDraft(baseline);
										setErrors({});
										save.reset();
										revalidate.reset();
										setSaveFeedback(null);
									}}
									variant="ghost"
								>
									<Undo2 className="size-4" />
									放弃更改
								</Button>
							) : null}
						</ActionGroup>
					</fieldset>
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
					size="icon"
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

function ReadOnlySetting({ label, value }: { label: string; value: string }) {
	return (
		<div className="min-w-0">
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="mt-1 break-words font-medium text-foreground">{value}</dd>
		</div>
	);
}

function focusFirstInvalid(formRef: RefObject<HTMLFormElement | null>) {
	requestAnimationFrame(() => {
		formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
	});
}
