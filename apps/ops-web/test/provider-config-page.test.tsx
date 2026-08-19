import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OpsWebApp } from "../src/app/ops-web-app";
import type { ExecutionModelSettingsStatus } from "../src/shared/ops-contract";

const executionStatus: ExecutionModelSettingsStatus = {
	embeddingContract: {
		dimensions: 2560,
		model: "Qwen3-Embedding-4B",
		provider: "openai-compatible",
		transport: "embeddings",
	},
	sampledAt: "2026-07-21T01:00:00.000Z",
	settings: {
		embedding: {
			baseUrl: "https://embedding.example.test/v1",
			credentialConfigured: true,
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
			kind: "llm",
			latestValidation: null,
			model: "primary-model",
			provider: "openai",
			transport: "responses",
			updatedAt: "2026-07-21T01:00:00.000Z",
			updatedBy: "ops@example.test",
		},
		notice_classifier: {
			baseUrl: "https://classifier.example.test/v1",
			credentialConfigured: true,
			kind: "notice_classifier",
			latestValidation: null,
			model: "deepseek-v4-flash-0731",
			provider: "openai-compatible",
			transport: "chat_completions",
			updatedAt: "2026-07-21T01:00:00.000Z",
			updatedBy: "ops@example.test",
		},
	},
};

describe("model settings page", () => {
	it("keeps the Embedding vector-space contract read-only", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json(executionStatus)),
		);
		render(<OpsWebApp initialPath="/providers" />);

		expect(await screen.findByRole("heading", { name: "模型配置" })).toBeInTheDocument();
		expect(await screen.findByText("Qwen3-Embedding-4B")).toBeInTheDocument();
		expect(screen.getByText("2560")).toBeInTheDocument();
		expect(screen.queryByDisplayValue("Qwen3-Embedding-4B")).not.toBeInTheDocument();
		for (const button of screen.getAllByRole("button", { name: "保存并验证" })) {
			expect(button).toBeDisabled();
		}
		expect(screen.getAllByText("当前密钥已配置；留空保持不变。")).toHaveLength(3);

		expect(screen.getAllByText("高级设置")).toHaveLength(2);
		expect(screen.queryByLabelText("请求超时（秒）")).not.toBeInTheDocument();
	});

	it("saves only the editable Embedding connection", async () => {
		let savedBody: Record<string, unknown> | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
				if (init?.method === "PUT") {
					savedBody = JSON.parse(String(init.body)) as Record<string, unknown>;
				}
				return Response.json(executionStatus);
			}),
		);
		render(<OpsWebApp initialPath="/providers" />);

		fireEvent.change(await screen.findByDisplayValue("https://embedding.example.test/v1"), {
			target: { value: "https://embedding-next.example.test/v1" },
		});
		const save = screen.getAllByRole("button", { name: "保存并验证" })[1];
		if (!save) {
			throw new Error("Expected the Embedding save button.");
		}
		fireEvent.click(save);

		await waitFor(() =>
			expect(savedBody).toEqual({
				baseUrl: "https://embedding-next.example.test/v1",
			}),
		);
	});

	it("allows Embedding configuration before the first Campus Docs index exists", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					...executionStatus,
					settings: { ...executionStatus.settings, embedding: null },
				}),
			),
		);
		render(<OpsWebApp initialPath="/providers" />);

		expect(await screen.findByLabelText("Embedding API Key")).toBeEnabled();
		expect(screen.queryByText(/尚未发布 Campus Docs 当前索引/u)).not.toBeInTheDocument();
		expect(screen.getByDisplayValue("https://provider.example.test/v1")).toBeEnabled();
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

		fireEvent.click(await screen.findByRole("button", { name: "获取LLM模型" }));

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

	it("treats failed save validation as a business failure", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
				if (init?.method === "PUT") {
					return Response.json(
						{ error: { code: "provider_timeout", message: "provider request timed out" } },
						{ status: 422 },
					);
				}
				return Response.json(executionStatus);
			}),
		);
		render(<OpsWebApp initialPath="/providers" />);
		const baseUrl = await screen.findByDisplayValue("https://provider.example.test/v1");
		fireEvent.change(baseUrl, { target: { value: "https://provider-next.example.test/v1" } });
		const [save] = screen.getAllByRole("button", { name: "保存并验证" });
		if (!save) {
			throw new Error("Expected a save button.");
		}
		fireEvent.click(save);

		expect(await screen.findByText(/新配置验证未通过，当前配置未更改/u)).toBeInTheDocument();
		expect(screen.getByText(/provider request timed out/u)).toBeInTheDocument();
	});
});
