// @vitest-environment node

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProjection } from "@campus-agent/provider-config";
import type { V1Secret } from "@kubernetes/client-node";
import { describe, expect, it, vi } from "vitest";
import {
	createFileProviderConfigPublisher,
	createKubernetesProviderConfigPublisher,
} from "../src/server/provider-config-publisher.ts";

const actor = { displayName: "Operator", principalId: "operator-1" };
const profile = {
	api_key: "secret",
	base_url: "https://provider.example/v1",
	kind: "prompt" as const,
	model: "model",
	profile_id: "profile-1",
	provider: "openai-compatible",
	revision: 1,
	role: "primary_agent" as const,
	timeout_ms: 30_000,
	transport: "responses",
};

describe("provider config publisher", () => {
	it("creates a private local directory and atomically publishes strict v2 content", async () => {
		const root = await mkdtemp(join(tmpdir(), "ops-web-provider-publisher-"));
		const path = join(root, "nested", "provider-config.json");
		const publisher = createFileProviderConfigPublisher(path);
		const projection = createProjection({ actor, profiles: { primary_agent: profile } });

		try {
			await publisher.verifyReadiness();
			await publisher.publish(projection);

			expect((await stat(path)).mode & 0o777).toBe(0o600);
			expect(JSON.parse(await readFile(path, "utf8"))).toEqual(projection);
			await expect(publisher.read()).resolves.toMatchObject({ projection });
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});

	it("uses resourceVersion CAS and verifies the Kubernetes Secret write", async () => {
		let secret: V1Secret = {
			apiVersion: "v1",
			kind: "Secret",
			metadata: { name: "execution-runtime-provider-config", resourceVersion: "17" },
			type: "Opaque",
		};
		const patchNamespacedSecret = vi.fn(async ({ body }: { body: Record<string, unknown>[] }) => {
			expect(body[0]).toEqual({ op: "test", path: "/metadata/resourceVersion", value: "17" });
			const annotations = body.find((item) => item.path === "/metadata/annotations")?.value;
			const data = body.find((item) => item.path === "/data")?.value;
			secret = {
				...secret,
				data: data as Record<string, string>,
				metadata: {
					...secret.metadata,
					annotations: annotations as Record<string, string>,
					resourceVersion: "18",
				},
			};
			return secret;
		});
		const api = { patchNamespacedSecret, readNamespacedSecret: vi.fn(async () => secret) };
		const publisher = createKubernetesProviderConfigPublisher({ api, namespace: "test" });
		const projection = createProjection({ actor, profiles: { primary_agent: profile } });

		const status = await publisher.publish(projection);

		expect(status.configured).toBe(true);
		expect(status.publicationId).toBe(projection.publication_id);
		expect(patchNamespacedSecret).toHaveBeenCalledOnce();
		await expect(publisher.verifyReadiness()).resolves.toBeUndefined();
	});
});
