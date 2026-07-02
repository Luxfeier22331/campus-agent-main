// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	ProviderConfigConnection,
	ProviderConfigProfile,
} from "../src/panel/operations/provider-config/model";
import { ProviderConfigPage } from "../src/panel/operations/provider-config/page";

function createQueryClient() {
	return new QueryClient({
		defaultOptions: {
			mutations: { retry: false },
			queries: { retry: false },
		},
	});
}

function renderWithQueryClient(children: ReactNode) {
	return render(<QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>);
}

function providerConnection(
	overrides: Partial<ProviderConfigConnection> = {},
): ProviderConfigConnection {
	return {
		baseUrl: "https://provider.example/v1",
		connectionId: "provider_connection_1",
		createdAt: "2026-06-16T00:00:00.000Z",
		featureConfig: {},
		features: ["prompt", "embedding"],
		provider: "openai-compatible",
		revision: 1,
		secretConfigured: true,
		secretLast4: "1234",
		updatedAt: "2026-06-16T00:00:00.000Z",
		...overrides,
	};
}

function providerProfile(
	overrides: Partial<ProviderConfigProfile> & Pick<ProviderConfigProfile, "profileId" | "role">,
): ProviderConfigProfile {
	const { profileId, role, ...restOverrides } = overrides;
	const kind = role.endsWith("_embedding") ? "embedding" : "prompt";
	return {
		active: false,
		baseUrl: "https://provider.example/v1",
		connectionId: "provider_connection_1",
		createdAt: "2026-06-16T00:00:00.000Z",
		dimensions: kind === "embedding" ? 2560 : null,
		kind,
		model: kind === "embedding" ? "embedding-test" : "gpt-test",
		profileId,
		provider: "openai-compatible",
		revision: 1,
		role,
		secretConfigured: true,
		secretLast4: "1234",
		status: "draft",
		timeoutMs: 30000,
		transport: kind === "embedding" ? "embeddings" : "responses",
		updatedAt: "2026-06-16T00:00:00.000Z",
		validation: null,
		...restOverrides,
	};
}

function mockConnectionList(connections: ProviderConfigConnection[]) {
	return new Response(JSON.stringify({ connections }), {
		headers: { "content-type": "application/json" },
		status: 200,
	});
}

function mockProfileList(profiles: ProviderConfigProfile[]) {
	return new Response(JSON.stringify({ profiles }), {
		headers: { "content-type": "application/json" },
		status: 200,
	});
}

async function findProfileRow(container: HTMLElement, label: string): Promise<HTMLTableRowElement> {
	let row: HTMLTableRowElement | undefined;
	await waitFor(() => {
		const renderedRow = Array.from(container.querySelectorAll("tbody tr")).find((candidate) =>
			candidate.textContent?.includes(label),
		);
		expect(renderedRow).toBeInstanceOf(HTMLTableRowElement);
		row = renderedRow as HTMLTableRowElement;
	});
	if (row === undefined) {
		throw new Error(`Profile row was not rendered for ${label}.`);
	}
	return row;
}

describe("provider config UI", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("presents provider connections and runtime profiles as operator-facing settings", async () => {
		vi.spyOn(globalThis, "fetch").mockImplementation(async (request) => {
			const url = String(request);
			if (url === "/api/operator/provider-config/connections") {
				return mockConnectionList([providerConnection()]);
			}
			if (url === "/api/operator/provider-config/profiles") {
				return mockProfileList([
					providerProfile({
						active: false,
						profileId: "provider_profile_draft",
						role: "primary_agent",
						status: "draft",
					}),
					providerProfile({
						active: true,
						profileId: "provider_profile_active",
						role: "rag_synthesis",
						status: "active",
					}),
					providerProfile({
						profileId: "provider_profile_rag_embedding",
						role: "rag_query_embedding",
					}),
					providerProfile({
						profileId: "provider_profile_index_embedding",
						role: "index_embedding",
					}),
					providerProfile({
						profileId: "provider_profile_hindsight_llm",
						role: "hindsight_llm",
					}),
					providerProfile({
						profileId: "provider_profile_hindsight_embedding",
						role: "hindsight_embedding",
					}),
					providerProfile({
						profileId: "provider_profile_eval_ragas_llm",
						role: "eval_ragas_llm",
					}),
					providerProfile({
						profileId: "provider_profile_eval_ragas_embedding",
						role: "eval_ragas_embedding",
					}),
					providerProfile({
						profileId: "provider_profile_eval_judge_llm",
						role: "eval_judge_llm",
					}),
				]);
			}
			throw new Error(`unexpected fetch ${url}`);
		});

		renderWithQueryClient(<ProviderConfigPage />);

		expect(await screen.findByText("Provider Connection")).toBeInTheDocument();
		expect(screen.getByText("保存模型服务端点、密钥和支持的能力。")).toBeInTheDocument();
		expect(screen.getByLabelText("服务类型")).toBeInTheDocument();
		expect(screen.getAllByText("服务端点").length).toBeGreaterThan(0);
		expect(screen.getByLabelText("密钥")).toBeInTheDocument();
		expect(screen.getByLabelText("支持能力")).toBeInTheDocument();
		expect(screen.getByText("Runtime Profile")).toBeInTheDocument();
		expect(screen.getByLabelText("使用位置")).toBeInTheDocument();
		expect(screen.getByLabelText("模型连接")).toBeInTheDocument();
		expect(screen.getAllByText("模型名称").length).toBeGreaterThan(0);
		expect(screen.getByText("向量维度")).toBeInTheDocument();
		expect(screen.getByText("超时时间")).toBeInTheDocument();
		expect(screen.getByText("生成模型不需要向量维度")).toBeInTheDocument();
		expect(screen.getAllByText("主问答生成").length).toBeGreaterThan(0);
		expect(screen.getAllByText("知识问答生成").length).toBeGreaterThan(0);
		expect(screen.getAllByText("记忆生成").length).toBeGreaterThan(0);
		expect(screen.getAllByText("知识检索向量化").length).toBeGreaterThan(0);
		expect(screen.getAllByText("索引构建向量化").length).toBeGreaterThan(0);
		expect(screen.getAllByText("记忆向量化").length).toBeGreaterThan(0);
		expect(screen.getAllByText("RAGAS 评测生成").length).toBeGreaterThan(0);
		expect(screen.getAllByText("RAGAS 评测向量化").length).toBeGreaterThan(0);
		expect(screen.getAllByText("评测裁判生成").length).toBeGreaterThan(0);
		expect(screen.queryByText("角色")).not.toBeInTheDocument();
		expect(screen.queryByText("Base URL")).not.toBeInTheDocument();
		expect(screen.queryByText("Model")).not.toBeInTheDocument();
		expect(screen.queryByText("Dimensions")).not.toBeInTheDocument();
		expect(screen.queryByText("Timeout ms")).not.toBeInTheDocument();
		expect(await screen.findByRole("row", { name: /知识问答生成/ })).toHaveTextContent("已启用");
	});

	it("shows validation failures on the affected profile row", async () => {
		vi.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(mockConnectionList([providerConnection()]))
			.mockResolvedValueOnce(
				mockProfileList([
					providerProfile({
						profileId: "provider_profile_draft",
						role: "rag_synthesis",
						status: "draft",
					}),
				]),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						error: {
							code: "provider_request_failed",
							message: "provider unavailable",
						},
					}),
					{ headers: { "content-type": "application/json" }, status: 500 },
				),
			);

		const { container } = renderWithQueryClient(<ProviderConfigPage />);

		const row = await findProfileRow(container, "知识问答生成");
		fireEvent.click(within(row).getByRole("button", { name: "校验" }));

		await waitFor(() => {
			expect(within(row).getByText("provider unavailable")).toBeInTheDocument();
		});
	});

	it("creates a connection before creating a profile that references it", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(mockConnectionList([]))
			.mockResolvedValueOnce(mockProfileList([]))
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						connection: providerConnection({ connectionId: "provider_connection_new" }),
					}),
					{
						headers: { "content-type": "application/json" },
						status: 200,
					},
				),
			)
			.mockResolvedValueOnce(
				mockConnectionList([providerConnection({ connectionId: "provider_connection_new" })]),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ profile: { profileId: "provider_profile_created" } }), {
					headers: { "content-type": "application/json" },
					status: 200,
				}),
			)
			.mockResolvedValueOnce(mockProfileList([]));

		renderWithQueryClient(<ProviderConfigPage />);

		await screen.findByText("暂无模型服务连接");
		fireEvent.change(screen.getByLabelText("服务端点"), {
			target: { value: "https://llm-compatible.example/v1" },
		});
		fireEvent.change(screen.getByLabelText("密钥"), { target: { value: "provider-key" } });
		fireEvent.click(screen.getByRole("button", { name: "保存连接" }));

		await waitFor(() => {
			expect(fetchSpy).toHaveBeenCalledWith(
				"/api/operator/provider-config/connections",
				expect.objectContaining({ method: "POST" }),
			);
		});

		fireEvent.change(screen.getByLabelText("模型名称"), { target: { value: "gpt-compatible" } });
		fireEvent.click(screen.getByRole("button", { name: "保存配置档案" }));

		await waitFor(() => {
			expect(fetchSpy).toHaveBeenCalledWith(
				"/api/operator/provider-config/profiles",
				expect.objectContaining({ method: "POST" }),
			);
		});
		const connectionRequest = fetchSpy.mock.calls.find(
			(call) =>
				call[0] === "/api/operator/provider-config/connections" && call[1]?.method === "POST",
		);
		const profileRequest = fetchSpy.mock.calls.find(
			(call) => call[0] === "/api/operator/provider-config/profiles" && call[1]?.method === "POST",
		);
		const connectionPayload = JSON.parse(String(connectionRequest?.[1]?.body));
		const profilePayload = JSON.parse(String(profileRequest?.[1]?.body));
		expect(connectionPayload).toMatchObject({
			apiKey: "provider-key",
			baseUrl: "https://llm-compatible.example/v1",
			features: ["prompt"],
			provider: "openai-compatible",
		});
		expect(profilePayload).toMatchObject({
			connectionId: "provider_connection_new",
			kind: "prompt",
			model: "gpt-compatible",
			role: "primary_agent",
			transport: "responses",
		});
		expect(profilePayload).not.toHaveProperty("apiKey");
		expect(profilePayload).not.toHaveProperty("baseUrl");
	});
});
