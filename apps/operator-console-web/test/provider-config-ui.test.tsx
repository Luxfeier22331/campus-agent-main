// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderConfigProfile } from "../src/panel/operations/provider-config/model";
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

function providerProfile(
	overrides: Partial<ProviderConfigProfile> & Pick<ProviderConfigProfile, "profileId" | "role">,
): ProviderConfigProfile {
	const { profileId, role, ...restOverrides } = overrides;
	const kind = role.endsWith("_embedding") ? "embedding" : "prompt";
	return {
		active: false,
		baseUrl: "https://provider.example/v1",
		createdAt: "2026-06-16T00:00:00.000Z",
		dimensions: kind === "embedding" ? 2560 : null,
		kind,
		model: kind === "embedding" ? "embedding-test" : "gpt-test",
		profileId,
		provider: "openai",
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

function mockProfileList(profiles: ProviderConfigProfile[]) {
	return new Response(JSON.stringify({ profiles }), {
		headers: { "content-type": "application/json" },
		status: 200,
	});
}

describe("provider config UI", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("presents provider profiles as operator-facing OpenAI-compatible endpoint settings", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			mockProfileList([
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
			]),
		);

		renderWithQueryClient(<ProviderConfigPage />);

		expect(await screen.findByText("OpenAI-compatible 模型端点")).toBeInTheDocument();
		expect(screen.getByText("配置 OpenAI-compatible 生成模型和向量模型端点。")).toBeInTheDocument();
		expect(screen.getByLabelText("使用位置")).toBeInTheDocument();
		expect(screen.getAllByText("服务端点").length).toBeGreaterThan(0);
		expect(screen.getAllByText("模型名称").length).toBeGreaterThan(0);
		expect(screen.getByLabelText("密钥")).toBeInTheDocument();
		expect(screen.getByText("向量维度")).toBeInTheDocument();
		expect(screen.getByText("超时时间")).toBeInTheDocument();
		expect(screen.getByText("配置档案")).toBeInTheDocument();
		expect(screen.getByText("生成模型不需要向量维度")).toBeInTheDocument();
		expect(screen.getByText("主问答生成")).toBeInTheDocument();
		expect(screen.getByText("知识问答生成")).toBeInTheDocument();
		expect(screen.getByText("知识检索向量化")).toBeInTheDocument();
		expect(screen.getByText("索引构建向量化")).toBeInTheDocument();
		expect(screen.queryByText("角色")).not.toBeInTheDocument();
		expect(screen.queryByText("Base URL")).not.toBeInTheDocument();
		expect(screen.queryByText("Model")).not.toBeInTheDocument();
		expect(screen.queryByText("Dimensions")).not.toBeInTheDocument();
		expect(screen.queryByText("Timeout ms")).not.toBeInTheDocument();
		expect(screen.queryByText("Profiles")).not.toBeInTheDocument();
		expect(screen.queryByText("Endpoint")).not.toBeInTheDocument();
		expect(screen.queryByText("Key")).not.toBeInTheDocument();
		expect(await screen.findByRole("row", { name: /知识问答生成/ })).toHaveTextContent("已启用");
	});

	it("shows validation failures on the affected profile row", async () => {
		vi.spyOn(globalThis, "fetch")
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

		renderWithQueryClient(<ProviderConfigPage />);

		const row = await screen.findByRole("row", { name: /知识问答生成/ });
		fireEvent.click(within(row).getByRole("button", { name: "校验" }));

		await waitFor(() => {
			expect(within(row).getByText("provider unavailable")).toBeInTheDocument();
		});
	});
});
