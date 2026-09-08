import { Button, Card, CardContent, Input, Label } from "@campus-agent/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { fetchJson } from "./ops-api/core";
import { ErrorState } from "./ops-display";
import { UnsavedChangesGuard } from "./provider-config-ui";

interface OcrConfigView {
	base_url: string;
	updated_at: string;
	credential_configured: boolean;
	validation: { status: "passed" | "failed"; message: string } | null;
}
const key = ["ocr", "config"];
export function OcrConfigForm() {
	const config = useQuery({
		queryKey: key,
		queryFn: ({ signal }) =>
			fetchJson("/api/ops/model-configs/document_ocr", { signal }) as Promise<OcrConfigView | null>,
		refetchInterval: 5000,
	});
	if (config.isPending) {
		return <p>正在读取 OCR 配置…</p>;
	}
	if (config.isError) {
		return (
			<ErrorState error={config.error} onRetry={() => config.refetch()} title="OCR 配置读取失败" />
		);
	}
	return <Form key={config.data?.updated_at ?? "new"} config={config.data ?? null} />;
}
function Form({ config }: { config: OcrConfigView | null }) {
	const client = useQueryClient();
	const [baseUrl, setBaseUrl] = useState(config?.base_url ?? "https://paddleocr.aistudio-app.com");
	const [apiKey, setApiKey] = useState("");
	const [message, setMessage] = useState("");
	const dirty =
		apiKey !== "" || baseUrl !== (config?.base_url ?? "https://paddleocr.aistudio-app.com");
	const save = useMutation({
		mutationFn: () =>
			fetchJson("/api/ops/model-configs/document_ocr", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ baseUrl, ...(apiKey ? { apiKey } : {}) }),
			}),
		onSuccess: async () => {
			setApiKey("");
			await client.invalidateQueries({ queryKey: key });
		},
	});
	const validate = useMutation({
		mutationFn: () =>
			fetchJson("/api/ops/model-configs/document_ocr/validate", { method: "POST" }) as Promise<{
				launchError: string | null;
			}>,
		onSuccess: (result) =>
			setMessage(
				result.launchError
					? `任务已保存，启动失败：${result.launchError}；请在文档识别页恢复。`
					: "验证任务已提交，可在文档识别页查看进度。",
			),
	});
	return (
		<Card className="mt-4">
			<CardContent className="space-y-4 p-5">
				<UnsavedChangesGuard dirty={dirty} />
				<div>
					<h2 className="font-semibold">文档 OCR · PaddleOCR-VL-1.6</h2>
					<p className="text-sm text-muted-foreground">
						识别通知图片与 PDF。保存后可单独验证连接。
					</p>
				</div>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						save.mutate();
					}}
					className="grid gap-4 md:grid-cols-2"
				>
					<div className="space-y-1">
						<Label htmlFor="ocr-base-url">服务地址</Label>
						<Input
							id="ocr-base-url"
							type="url"
							required
							value={baseUrl}
							onChange={(e) => setBaseUrl(e.target.value)}
						/>
					</div>
					<div className="space-y-1">
						<Label htmlFor="ocr-key">API Key</Label>
						<Input
							id="ocr-key"
							type="password"
							autoComplete="new-password"
							required={!config?.credential_configured}
							value={apiKey}
							onChange={(e) => setApiKey(e.target.value)}
							placeholder={
								config?.credential_configured ? "已配置，留空保持不变" : "填写 Paddle API Key"
							}
						/>
					</div>
					<div className="flex gap-2">
						<Button type="submit" disabled={save.isPending}>
							{save.isPending ? "保存中…" : "保存配置"}
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={!config || dirty || validate.isPending}
							onClick={() => validate.mutate()}
						>
							验证连接
						</Button>
					</div>
				</form>
				<p className="text-sm">
					{config?.validation
						? `${config.validation.status === "passed" ? "验证通过" : "验证失败"}：${config.validation.message}`
						: "尚未验证"}
				</p>
				{message ? <p role="status">{message}</p> : null}
				{save.error || validate.error ? (
					<p role="alert" className="text-destructive">
						{(save.error ?? validate.error)?.message}
					</p>
				) : null}
			</CardContent>
		</Card>
	);
}
