#!/usr/bin/env node
import http from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 9798;
const DEFAULT_AUDIENCE = "panel-local-smoke";
const DEFAULT_EMAIL = "ops@example.com";
const DEFAULT_NAME = "Local Smoke Operator";
const DEFAULT_SUBJECT = "operator-local-smoke";
const DEFAULT_REDIRECT = "http://127.0.0.1:5174/observability/overview";
const TOKEN_TTL_SECONDS = 30 * 60;
const LOCAL_REDIRECT_HOSTS = new Set(["127.0.0.1", "localhost"]);

function readPort() {
	const raw = process.env.PANEL_LOCAL_ACCESS_PORT?.trim();
	if (!raw) {
		return DEFAULT_PORT;
	}

	const port = Number(raw);
	if (!Number.isInteger(port) || port <= 0 || port > 65535) {
		throw new Error("PANEL_LOCAL_ACCESS_PORT must be a valid TCP port.");
	}

	return port;
}

function readValue(name, fallback) {
	return process.env[name]?.trim() || fallback;
}

function sanitizeRedirectTarget(value) {
	const candidate = value?.trim() || DEFAULT_REDIRECT;
	try {
		const parsed = new URL(candidate);
		if (!["http:", "https:"].includes(parsed.protocol)) {
			return DEFAULT_REDIRECT;
		}
		if (!LOCAL_REDIRECT_HOSTS.has(parsed.hostname)) {
			return DEFAULT_REDIRECT;
		}

		return parsed.toString();
	} catch {
		return DEFAULT_REDIRECT;
	}
}

function jsonResponse(response, status, payload) {
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-type": "application/json; charset=utf-8",
	});
	response.end(JSON.stringify(payload));
}

function htmlResponse(response, status, body) {
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-type": "text/html; charset=utf-8",
	});
	response.end(body);
}

function buildCookie(token) {
	return [
		`CF_Authorization=${token}`,
		"Path=/",
		"HttpOnly",
		"SameSite=Lax",
		`Max-Age=${TOKEN_TTL_SECONDS}`,
	].join("; ");
}

async function main() {
	const host = readValue("PANEL_LOCAL_ACCESS_HOST", DEFAULT_HOST);
	const port = readPort();
	const issuer = readValue("PANEL_LOCAL_ACCESS_ISSUER", `http://${host}:${port}`);
	const audience = readValue("PANEL_LOCAL_ACCESS_AUD", DEFAULT_AUDIENCE);
	const email = readValue("PANEL_LOCAL_ACCESS_EMAIL", DEFAULT_EMAIL);
	const name = readValue("PANEL_LOCAL_ACCESS_NAME", DEFAULT_NAME);
	const subject = readValue("PANEL_LOCAL_ACCESS_SUB", DEFAULT_SUBJECT);
	const { privateKey, publicKey } = await generateKeyPair("ES256");
	const publicJwk = await exportJWK(publicKey);
	const keyId = "panel-local-smoke-key";
	publicJwk.kid = keyId;
	publicJwk.alg = "ES256";
	publicJwk.use = "sig";

	async function createToken() {
		return new SignJWT({
			email,
			groups: ["panel", "ops"],
			name,
			sub: subject,
		})
			.setProtectedHeader({ alg: "ES256", kid: keyId })
			.setIssuer(issuer)
			.setAudience(audience)
			.setIssuedAt()
			.setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
			.sign(privateKey);
	}

	const server = http.createServer(async (request, response) => {
		try {
			const url = new URL(request.url ?? "/", issuer);
			if (request.method === "GET" && url.pathname === "/healthz") {
				jsonResponse(response, 200, {
					audience,
					issuer,
					status: "ok",
				});
				return;
			}

			if (request.method === "GET" && url.pathname === "/cdn-cgi/access/certs") {
				jsonResponse(response, 200, {
					keys: [publicJwk],
				});
				return;
			}

			if (request.method === "GET" && url.pathname === "/login") {
				const redirect = sanitizeRedirectTarget(url.searchParams.get("redirect"));
				const token = await createToken();
				response.writeHead(302, {
					"cache-control": "no-store",
					location: redirect,
					"set-cookie": buildCookie(token),
				});
				response.end();
				return;
			}

			if (request.method === "GET" && url.pathname === "/") {
				htmlResponse(
					response,
					200,
					`<!doctype html><html><body><a href="/login?redirect=${encodeURIComponent(
						DEFAULT_REDIRECT,
					)}">Enter protected panel smoke</a></body></html>`,
				);
				return;
			}

			jsonResponse(response, 404, {
				error: {
					code: "not_found",
					message: "Local Access smoke endpoint not found.",
				},
			});
		} catch (error) {
			jsonResponse(response, 500, {
				error: {
					code: "local_access_smoke_error",
					message: error instanceof Error ? error.message : "Unknown local access smoke error.",
				},
			});
		}
	});

	server.listen(port, host, () => {
		console.log(
			`protected-panel local Access smoke issuer listening at ${issuer}; open ${issuer}/login`,
		);
	});

	for (const signal of ["SIGINT", "SIGTERM"]) {
		process.on(signal, () => {
			server.close(() => {
				process.exit(0);
			});
		});
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
