import { describe, expect, it, vi } from "vitest";
import { createMemoryServiceClient } from "../src/modules/integration/memory-service";

describe("independent Memory transport", () => {
	it("routes deployed reads through the Memory VPC binding", async () => {
		const memoryFetch = vi.fn<typeof fetch>().mockResolvedValue(
			Response.json({
				content: "profile",
				generating: false,
				is_stale: false,
				last_refreshed_at: "2026-10-10T00:00:00Z",
			}),
		);
		const publicFetch = vi.fn<typeof fetch>();
		const client = createMemoryServiceClient(
			{
				DEPLOYMENT_ENVIRONMENT: "staging",
				MEMORY_SERVICE_BASE_URL: "http://memory-service",
				MEMORY_SERVICE_PRIVATE_ORIGIN: "http://memory-private",
				MEMORY_SERVICE_PRIVATE: { fetch: memoryFetch },
				MEMORY_INTERNAL_SHARED_SECRET: "test-secret",
			},
			{ fetchImplementation: publicFetch },
		);
		expect(await client.getProfile({ ownerUserId: "user", ownerGeneration: 2 })).toMatchObject({
			content: "profile",
			isStale: false,
		});
		expect(publicFetch).not.toHaveBeenCalled();
		expect(memoryFetch).toHaveBeenCalledWith(
			"http://memory-private/internal/memory/profile",
			expect.objectContaining({
				body: JSON.stringify({
					tenant_id: "tenant-main",
					owner_user_id: "user",
					owner_generation: 2,
				}),
				headers: expect.objectContaining({ "x-memory-origin-auth": "test-secret" }),
			}),
		);
	});
	it("preserves lifecycle conflicts from Memory", async () => {
		const fetchImplementation = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				Response.json({ error: { code: "memory_owner_not_drained" } }, { status: 409 }),
			);
		const client = createMemoryServiceClient(
			{
				DEPLOYMENT_ENVIRONMENT: "development",
				MEMORY_SERVICE_BASE_URL: "http://memory",
				MEMORY_INTERNAL_SHARED_SECRET: "test-secret",
			},
			{ fetchImplementation },
		);
		await expect(client.finalizeOwnerDeletion({ ownerUserId: "user" })).rejects.toMatchObject({
			code: "memory_owner_not_drained",
			status: 409,
			retryable: false,
		});
	});
});
