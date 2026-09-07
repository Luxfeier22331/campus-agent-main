import { describe, expect, it } from "vitest";

import { connectToKubernetesObjectStore } from "../src/kubectl.ts";

describe("Kubernetes object-store connection", () => {
	it("reads the existing read credentials and exposes the forwarded endpoint", async () => {
		const calls: string[][] = [];
		let closed = false;
		const connection = await connectToKubernetesObjectStore({
			context: "staging",
			dependencies: {
				runKubectl: async (args) => {
					calls.push(args);
					return args.at(-1) === "jsonpath={.data.OBJECT_STORE_DERIVED_READ_ACCESS_KEY}"
						? Buffer.from("read-access").toString("base64")
						: Buffer.from("read-secret").toString("base64");
				},
				startPortForward: async () => ({
					close: async () => {
						closed = true;
					},
					port: 41234,
				}),
			},
			namespace: "campus-agent-staging",
		});

		expect(connection.accessKeyId).toBe("read-access");
		expect(connection.secretAccessKey).toBe("read-secret");
		expect(connection.endpoint).toBe("http://127.0.0.1:41234");
		expect(calls).toEqual([
			[
				"--context",
				"staging",
				"--namespace",
				"campus-agent-staging",
				"get",
				"secret",
				"object-store-secrets",
				"--output",
				"jsonpath={.data.OBJECT_STORE_DERIVED_READ_ACCESS_KEY}",
			],
			[
				"--context",
				"staging",
				"--namespace",
				"campus-agent-staging",
				"get",
				"secret",
				"object-store-secrets",
				"--output",
				"jsonpath={.data.OBJECT_STORE_DERIVED_READ_SECRET_KEY}",
			],
		]);
		await connection.close();
		expect(closed).toBe(true);
	});

	it("rejects an empty or malformed Kubernetes secret value", async () => {
		await expect(
			connectToKubernetesObjectStore({
				dependencies: { runKubectl: async () => "not-base64" },
				namespace: "campus-agent-staging",
			}),
		).rejects.toThrow("OBJECT_STORE_DERIVED_READ_ACCESS_KEY");
	});
});
