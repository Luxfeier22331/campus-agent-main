import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OpsWebApp } from "../src/app/ops-web-app";
import type { ExecutionModelSettingsStatus } from "../src/shared/ops-contract";

const executionStatus: ExecutionModelSettingsStatus = {
	etag: "etag-1",
	sampledAt: "2026-07-21T01:00:00.000Z",
	settings: {
		embedding: {
			baseUrl: "https://embedding.example.test/v1",
			credentialConfigured: true,
			credentialLast4: "demo",
			dimensions: 2560,
			kind: "embedding",
			latestValidation: null,
			model: "Qwen3-Embedding-4B",
			provider: "openai-compatible",
			transport: "embeddings",
			updatedAt: "2026-07-21T01:00:00.000Z",
			updatedBy: "ops@example.test",
		},
		llm: {
			baseUrl: "https://provider.example.test/v1",
			credentialConfigured: true,
			credentialLast4: "demo",
			kind: "llm",
			latestValidation: null,
			model: "primary-model",
			provider: "openai",
			transport: "responses",
			updatedAt: "2026-07-21T01:00:00.000Z",
			updatedBy: "ops@example.test",
		},
	},
};

describe("model settings page", () => {
	it("separates editable fields, fixed facts, and advanced settings", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json(executionStatus)),
		);
		render(<OpsWebApp initialPath="/providers" />);

		expect(await screen.findByRole("heading", { name: "模型配置" })).toBeInTheDocument();
		expect(await screen.findByText("Qwen3-Embedding-4B", { exact: true })).toBeInTheDocument();
		expect(screen.queryByDisplayValue("Qwen3-Embedding-4B")).not.toBeInTheDocument();
		for (const button of screen.getAllByRole("button", { name: "保存并验证" })) {
			expect(button).toBeDisabled();
		}
		expect(screen.getAllByText(/当前密钥末尾 demo；留空保持不变/u)).toHaveLength(2);

		expect(screen.getByText("高级设置")).toBeInTheDocument();
		expect(screen.queryByLabelText("请求超时（秒）")).not.toBeInTheDocument();
	});

	it("marks invalid fields, focuses the first error, and can discard edits", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json(executionStatus)),
		);
		render(<OpsWebApp initialPath="/providers" />);
		const baseUrl = await screen.findByDisplayValue("https://provider.example.test/v1");
		fireEvent.change(baseUrl, { target: { value: "not-a-url" } });
		const [save] = screen.getAllByRole("button", { name: "保存并验证" });
		if (!save) {
			throw new Error("Expected a save-and-validate button.");
		}
		expect(save).toBeEnabled();
		fireEvent.click(save);

		await waitFor(() => expect(baseUrl).toHaveFocus());
		expect(baseUrl).toHaveAttribute("aria-invalid", "true");
		expect(screen.getByText("请输入有效的 HTTP(S) 地址。")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "放弃更改" }));
		expect(baseUrl).toHaveValue("https://provider.example.test/v1");
		expect(screen.getAllByRole("button", { name: "保存并验证" })[0]).toBeDisabled();
	});

	it("discovers LLM models without exposing the saved API key", async () => {
		let discoveryBody: Record<string, unknown> | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				if (String(input).endsWith("/api/ops/model-settings/execution/llm/models")) {
					discoveryBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
					return Response.json({
						models: ["primary-model", "reasoning-model"],
						sampledAt: "2026-07-21T01:05:00.000Z",
					});
				}
				return Response.json(executionStatus);
			}),
		);
		render(<OpsWebApp initialPath="/providers" />);

		fireEvent.click(await screen.findByRole("button", { name: "获取模型" }));

		const model = await screen.findByRole("combobox", { name: "模型" });
		expect(model).toHaveValue("primary-model");
		expect(screen.getByRole("option", { name: "reasoning-model" })).toBeInTheDocument();
		expect(screen.getByText("已获取 2 个模型")).toBeInTheDocument();
		expect(discoveryBody).toEqual({
			apiKey: "",
			baseUrl: "https://provider.example.test/v1",
			provider: "openai",
		});
	});

	it("treats a failed validation result as a business failure", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
				if (init?.method === "POST") {
					return Response.json({
						kind: "llm",
						validation: {
							errorCode: "provider_timeout",
							message: "provider request timed out",
							status: "failed",
							validatedAt: "2026-07-21T01:05:00.000Z",
							validatedBy: "ops@example.test",
						},
					});
				}
				return Response.json(executionStatus);
			}),
		);
		render(<OpsWebApp initialPath="/providers" />);
		const [validate] = await screen.findAllByRole("button", { name: "重新验证" });
		if (!validate) {
			throw new Error("Expected a revalidate button.");
		}
		fireEvent.click(validate);

		expect(await screen.findByText(/已保存配置验证未通过/u)).toBeInTheDocument();
		expect(screen.getByText(/供应商验证超时/u)).toBeInTheDocument();
	});
});
