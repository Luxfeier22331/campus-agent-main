import {
	createServer as createHttpServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { createServer as createViteServer, type ViteDevServer } from "vite";

import { assertDiningWayfindingLayout } from "../src/floorplans/wayfinding-layout";
import {
	DiningLayoutRevisionConflictError,
	generateDiningFloorplanAssets,
	readDiningWayfindingLayoutDocuments,
	saveDiningWayfindingLayout,
} from "./floorplan-files";

const HOST = "127.0.0.1";
const PORT = 27019;
const MUTATION_REQUEST_HEADER = "x-dining-floorplan-editor";
const EDITOR_ROOT = dirname(fileURLToPath(new URL("./index.html", import.meta.url)));
const PACKAGE_ROOT = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
let vite: ViteDevServer;

const server = createHttpServer(async (request, response) => {
	try {
		if (await handleApiRequest(request, response)) {
			return;
		}
		vite.middlewares(request, response, (error: unknown) => {
			if (error) {
				writeJson(response, 500, {
					error: error instanceof Error ? error.message : "Vite middleware failed.",
				});
			}
		});
	} catch (error) {
		writeJson(response, error instanceof DiningLayoutRevisionConflictError ? 409 : 400, {
			code:
				error instanceof DiningLayoutRevisionConflictError ? "layout_conflict" : "invalid_request",
			error: error instanceof Error ? error.message : "Dining floorplan editor request failed.",
		});
	}
});

vite = await createViteServer({
	appType: "spa",
	plugins: [react()],
	root: EDITOR_ROOT,
	server: { fs: { allow: [PACKAGE_ROOT] }, hmr: { server }, middlewareMode: true },
});

server.listen(PORT, HOST, () => {
	console.log(`Dining floorplan editor: http://${HOST}:${PORT}`);
});

async function handleApiRequest(
	request: IncomingMessage,
	response: ServerResponse,
): Promise<boolean> {
	const url = new URL(request.url ?? "/", `http://${HOST}:${PORT}`);
	if (request.method === "GET" && url.pathname === "/__dining-floorplan-editor/layouts") {
		writeJson(response, 200, { documents: await readDiningWayfindingLayoutDocuments() });
		return true;
	}
	if (request.method === "POST" && url.pathname === "/__dining-floorplan-editor/assets/generate") {
		assertEditorMutationRequest(request);
		writeJson(response, 200, await generateDiningFloorplanAssets());
		return true;
	}
	const match = /^\/__dining-floorplan-editor\/layouts\/([a-z0-9-]+)$/.exec(url.pathname);
	if (request.method !== "PUT" || !match) {
		return false;
	}
	assertEditorMutationRequest(request);
	const body = JSON.parse(await readRequestBody(request)) as {
		baseRevision?: unknown;
		layout?: unknown;
	};
	assertDiningWayfindingLayout(body.layout);
	if (typeof body.baseRevision !== "string") {
		throw new Error("Dining layout base revision is required.");
	}
	const floorId = match[1];
	if (body.layout.floorId !== floorId) {
		throw new Error("Dining layout floorId does not match the request path.");
	}
	writeJson(
		response,
		200,
		await saveDiningWayfindingLayout({
			baseRevision: body.baseRevision,
			layout: body.layout,
		}),
	);
	return true;
}

function assertEditorMutationRequest(request: IncomingMessage): void {
	if (request.headers[MUTATION_REQUEST_HEADER] !== "1") {
		throw new Error("Dining floorplan editor mutation header is required.");
	}
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > 1_000_000) {
			throw new Error("Dining layout request body is too large.");
		}
		chunks.push(buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
	if (response.headersSent) {
		response.end();
		return;
	}
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-type": "application/json; charset=utf-8",
	});
	response.end(JSON.stringify(value));
}
