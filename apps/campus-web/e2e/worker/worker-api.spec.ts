import { expect, test } from "@playwright/test";

test("forwards browser API traffic through the built Worker and rejects an unknown route", async ({
	request,
}) => {
	for (const [method, path] of [
		["GET", "/api/chat/conversations"],
		["POST", "/api/chat/requests/stream"],
	] as const) {
		const response = await request.fetch(path, {
			method,
			...(method === "POST" ? { data: {} } : {}),
		});
		expect(response.status()).toBe(200);
		await expect(response.json()).resolves.toEqual({ method, path, service: "app-api-e2e-stub" });
	}
	const rejected = await request.get("/api/chat/admin");
	expect(rejected.status()).toBe(404);
	await expect(rejected.json()).resolves.toEqual({
		error: { code: "not_found", message: "这个接口不存在。" },
	});
});
