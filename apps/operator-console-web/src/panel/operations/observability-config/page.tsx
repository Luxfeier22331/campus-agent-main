import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { getPanelErrorMessage } from "../../panel-error";
import { Alert } from "../../ui/alert";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/card";
import { Field, FieldError, FieldLabel } from "../../ui/field";
import { Input } from "../../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import { Separator } from "../../ui/separator";
import { Skeleton } from "../../ui/skeleton";
import { getLlmDebugTraceConfig, updateLlmDebugTraceConfig } from "./api";
import type { LlmDebugTraceConfigSummary } from "./model";
import {
	buildObservabilityConfigUpdatePayload,
	formFromConfig,
	initialObservabilityConfigForm,
	type ObservabilityConfigFormState,
	observabilityConfigFormSchema,
} from "./view-model";

export function ObservabilityConfigPage() {
	const queryClient = useQueryClient();
	const [formError, setFormError] = useState<string | null>(null);
	const configForm = useForm<ObservabilityConfigFormState>({
		defaultValues: initialObservabilityConfigForm(),
		resolver: zodResolver(observabilityConfigFormSchema),
	});
	const configQuery = useQuery({
		queryFn: ({ signal }) => getLlmDebugTraceConfig({ signal }),
		queryKey: ["observability-config", "llm-debug-trace"],
	});
	const updateMutation = useMutation({
		mutationFn: updateLlmDebugTraceConfig,
		onError: (error) => {
			setFormError(getPanelErrorMessage(error, "保存观测配置失败。"));
		},
		onSuccess: (result) => {
			setFormError(null);
			configForm.reset(formFromConfig(result.config));
			void queryClient.invalidateQueries({
				queryKey: ["observability-config", "llm-debug-trace"],
			});
		},
	});
	const config = configQuery.data?.config;
	const selectedMode = configForm.watch("mode");

	useEffect(() => {
		if (!config) {
			return;
		}
		configForm.reset(formFromConfig(config));
	}, [config, configForm]);

	return (
		<section className="space-y-4">
			<Card>
				<CardHeader>
					<p className="font-semibold text-slate-500 text-xs uppercase">观测配置</p>
					<CardTitle>LLM Debug Trace</CardTitle>
					<CardDescription>
						配置在线问答链路是否向 Langfuse OTLP 写入受控 debug trace。
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{configQuery.error ? (
						<Alert tone="danger">
							{getPanelErrorMessage(configQuery.error, "观测配置读取失败。")}
						</Alert>
					) : null}
					{configQuery.isLoading ? (
						<div className="space-y-3">
							<Skeleton className="h-10 w-full" />
							<Skeleton className="h-10 w-full" />
							<Skeleton className="h-10 w-full" />
						</div>
					) : null}
					{config ? <ConfigSummary config={config} /> : null}
					<form
						className="grid gap-3 lg:grid-cols-2"
						onSubmit={configForm.handleSubmit((values) => {
							setFormError(null);
							updateMutation.mutate(buildObservabilityConfigUpdatePayload(values));
						})}
					>
						<Controller
							control={configForm.control}
							name="mode"
							render={({ field }) => (
								<Field>
									<FieldLabel htmlFor="llm-debug-trace-mode">模式</FieldLabel>
									<Select onValueChange={field.onChange} value={field.value}>
										<SelectTrigger id="llm-debug-trace-mode">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="off">关闭</SelectItem>
											<SelectItem value="langfuse_otlp">Langfuse OTLP</SelectItem>
										</SelectContent>
									</Select>
								</Field>
							)}
						/>
						<Field>
							<FieldLabel htmlFor="llm-debug-trace-sample-ratio">采样比例</FieldLabel>
							<Input
								id="llm-debug-trace-sample-ratio"
								inputMode="decimal"
								{...configForm.register("sampleRatio")}
							/>
							{configForm.formState.errors.sampleRatio ? (
								<FieldError>{configForm.formState.errors.sampleRatio.message}</FieldError>
							) : null}
						</Field>
						<Field>
							<FieldLabel htmlFor="llm-debug-trace-otlp-endpoint">OTLP Endpoint</FieldLabel>
							<Input
								disabled={selectedMode === "off"}
								id="llm-debug-trace-otlp-endpoint"
								{...configForm.register("otlpEndpoint")}
							/>
							{configForm.formState.errors.otlpEndpoint ? (
								<FieldError>{configForm.formState.errors.otlpEndpoint.message}</FieldError>
							) : null}
						</Field>
						<Field>
							<FieldLabel htmlFor="llm-debug-trace-public-url">Trace 链接前缀</FieldLabel>
							<Input
								disabled={selectedMode === "off"}
								id="llm-debug-trace-public-url"
								{...configForm.register("publicTraceBaseUrl")}
							/>
							{configForm.formState.errors.publicTraceBaseUrl ? (
								<FieldError>{configForm.formState.errors.publicTraceBaseUrl.message}</FieldError>
							) : null}
						</Field>
						<Field className="lg:col-span-2">
							<div className="flex items-center justify-between gap-3">
								<FieldLabel htmlFor="llm-debug-trace-auth-header">Authorization Header</FieldLabel>
								<span className="text-slate-500 text-xs">
									{config?.authHeaderConfigured
										? `已配置，尾号 ${config.authHeaderLast4 ?? "未知"}`
										: "未配置"}
								</span>
							</div>
							<Input
								autoComplete="off"
								disabled={selectedMode === "off"}
								id="llm-debug-trace-auth-header"
								type="password"
								{...configForm.register("authHeader")}
							/>
							<p className="text-slate-500 text-xs">
								留空表示不轮换密钥；启用 Langfuse OTLP 时必须已有密钥或填写新密钥。
							</p>
							{configForm.formState.errors.authHeader ? (
								<FieldError>{configForm.formState.errors.authHeader.message}</FieldError>
							) : null}
						</Field>
						<div className="lg:col-span-2">
							<Button
								disabled={updateMutation.isPending || configQuery.isLoading || !config}
								type="submit"
								variant="primary"
							>
								<Save aria-hidden="true" className="size-4" />
								保存观测配置
							</Button>
						</div>
						{formError ? (
							<Alert className="lg:col-span-2" tone="danger">
								{formError}
							</Alert>
						) : null}
					</form>
				</CardContent>
			</Card>
		</section>
	);
}

function ConfigSummary({ config }: { config: LlmDebugTraceConfigSummary }) {
	return (
		<div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<p className="font-medium text-sm">当前状态</p>
					<p className="mt-1 text-slate-500 text-sm">
						修订 {config.revision} · {config.updatedBy.displayName} · {config.updatedAt}
					</p>
				</div>
				<Badge tone={config.mode === "langfuse_otlp" ? "success" : "muted"}>
					<Activity aria-hidden="true" className="mr-1 size-3.5" />
					{config.mode === "langfuse_otlp" ? "已启用" : "已关闭"}
				</Badge>
			</div>
			<Separator className="my-4" />
			<div className="grid gap-3 md:grid-cols-2">
				<Fact label="采样比例" value={config.sampleRatio.toString()} />
				<Fact label="模型输入输出" value={config.includeModelIo ? "允许" : "不采集"} />
				<Fact label="OTLP Endpoint" value={config.otlpEndpoint || "未配置"} />
				<Fact label="Trace 链接前缀" value={config.publicTraceBaseUrl || "未配置"} />
			</div>
		</div>
	);
}

function Fact({ label, value }: { label: string; value: string }) {
	return (
		<div className="min-w-0">
			<p className="text-slate-500 text-xs">{label}</p>
			<p className="mt-1 break-words font-mono text-sm">{value}</p>
		</div>
	);
}
