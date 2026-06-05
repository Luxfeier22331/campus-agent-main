import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { symmetricDecrypt } from "better-auth/crypto";
import type { Pool } from "pg";
import { FEDERATION_ID_TOKEN_SIGNING_ALG } from "../src/modules/federation-runtime/config.ts";
import { buildFederationProviderRuntimeReadinessReport } from "../src/modules/federation-runtime/readiness.ts";

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");

function hasPackage(specifier: string): boolean {
	try {
		require.resolve(specifier);
		return true;
	} catch {
		return false;
	}
}

function hasRoutePattern(pattern: string): boolean {
	const source = readFileSync(resolve(repoRoot, "apps/app-api/src/app/route-exposure.ts"), "utf8");
	return source.includes(pattern);
}

const IMPLEMENTED_FEDERATION_ROUTES = [
	"/.well-known/openid-configuration",
	"/.well-known/oauth-authorization-server",
	"/api/federation/authorize",
	"/api/federation/token",
	"/api/federation/userinfo",
	"/api/federation/jwks",
	"/api/federation/logout",
] as const;

export interface FederationJwksSecretCompatibilityRow {
	id: string;
	privateKey: string;
	publicKey: string;
}

export interface FederationJwksSecretCompatibilityReport {
	algorithmCompatible: boolean;
	checked: boolean;
	compatible: boolean;
	expectedAlg: typeof FEDERATION_ID_TOKEN_SIGNING_ALG;
	keyCount: number;
	invalidAlgorithmKeyIds: string[];
	validKeyIds: string[];
	invalidKeyIds: string[];
	status:
		| "no_jwks_present"
		| "jwks_algorithm_mismatch"
		| "jwks_secret_compatible"
		| "jwks_secret_mismatch"
		| "jwks_secret_not_checked";
}

function isRs256JwkPair(input: { privateJwk: unknown; publicJwk: unknown }): boolean {
	if (
		!input.privateJwk ||
		typeof input.privateJwk !== "object" ||
		Array.isArray(input.privateJwk) ||
		!input.publicJwk ||
		typeof input.publicJwk !== "object" ||
		Array.isArray(input.publicJwk)
	) {
		return false;
	}

	const privateJwk = input.privateJwk as Record<string, unknown>;
	const publicJwk = input.publicJwk as Record<string, unknown>;
	return (
		privateJwk.kty === "RSA" &&
		publicJwk.kty === "RSA" &&
		typeof privateJwk.d === "string" &&
		typeof publicJwk.n === "string" &&
		typeof publicJwk.e === "string"
	);
}

export async function buildFederationJwksSecretCompatibilityReport(input: {
	betterAuthSecret?: string | null;
	rows?: FederationJwksSecretCompatibilityRow[];
	selectRows?: () => Promise<FederationJwksSecretCompatibilityRow[]>;
}): Promise<FederationJwksSecretCompatibilityReport> {
	const betterAuthSecret = input.betterAuthSecret?.trim();
	if (!betterAuthSecret) {
		return {
			algorithmCompatible: false,
			checked: false,
			compatible: false,
			expectedAlg: FEDERATION_ID_TOKEN_SIGNING_ALG,
			invalidAlgorithmKeyIds: [],
			invalidKeyIds: [],
			keyCount: 0,
			status: "jwks_secret_not_checked",
			validKeyIds: [],
		};
	}

	const rows = input.rows ?? (input.selectRows ? await input.selectRows() : []);
	const validKeyIds: string[] = [];
	const invalidKeyIds: string[] = [];
	const invalidAlgorithmKeyIds: string[] = [];

	for (const row of rows) {
		try {
			const decrypted = await symmetricDecrypt({
				data: JSON.parse(row.privateKey),
				key: betterAuthSecret,
			});
			const privateJwk = JSON.parse(decrypted);
			const publicJwk = JSON.parse(row.publicKey);
			if (!isRs256JwkPair({ privateJwk, publicJwk })) {
				invalidAlgorithmKeyIds.push(row.id);
			}
			validKeyIds.push(row.id);
		} catch {
			invalidKeyIds.push(row.id);
		}
	}

	if (rows.length === 0) {
		return {
			algorithmCompatible: true,
			checked: true,
			compatible: true,
			expectedAlg: FEDERATION_ID_TOKEN_SIGNING_ALG,
			invalidAlgorithmKeyIds,
			invalidKeyIds,
			keyCount: 0,
			status: "no_jwks_present",
			validKeyIds,
		};
	}

	const secretCompatible = invalidKeyIds.length === 0;
	const algorithmCompatible = invalidAlgorithmKeyIds.length === 0;
	const compatible = secretCompatible && algorithmCompatible;
	return {
		algorithmCompatible,
		checked: true,
		compatible,
		expectedAlg: FEDERATION_ID_TOKEN_SIGNING_ALG,
		invalidAlgorithmKeyIds,
		invalidKeyIds,
		keyCount: rows.length,
		status: secretCompatible
			? algorithmCompatible
				? "jwks_secret_compatible"
				: "jwks_algorithm_mismatch"
			: "jwks_secret_mismatch",
		validKeyIds,
	};
}

export function buildFederationRuntimeReadinessReport() {
	const oauthProviderInstalled = hasPackage("@better-auth/oauth-provider");
	const oidcProviderAvailable = hasPackage("better-auth/plugins");
	const providerRuntime = buildFederationProviderRuntimeReadinessReport();
	const productionRoutesExposed = IMPLEMENTED_FEDERATION_ROUTES.filter(hasRoutePattern);
	const allRoutesExposed = productionRoutesExposed.length === IMPLEMENTED_FEDERATION_ROUTES.length;

	return {
		recommendedProvider: "better-auth-oauth-provider",
		oauthProviderInstalled,
		oidcProviderAvailable,
		providerRuntime,
		routeExposure: {
			federationRoutesExposed: allRoutesExposed,
			productionRoutesExposed,
		},
		requiredChecks: [
			"worker-runtime-import",
			"drizzle-schema-generation",
			"static-client-registry",
			"redirect-uri-allowlist",
			"claims-policy-mapping",
			"jwks-and-key-rotation",
			"end-session-behavior",
		],
		status:
			oauthProviderInstalled &&
			providerRuntime.status === "provider_runtime_verified" &&
			allRoutesExposed
				? "provider_verified_routes_exposed"
				: "blocked_before_route_exposure",
	};
}

export async function buildFederationRuntimeReadinessReportWithDatabase(input: {
	betterAuthSecret?: string | null;
	pool: Pick<Pool, "query">;
}) {
	const report = buildFederationRuntimeReadinessReport();
	const jwksSecretCompatibility = await buildFederationJwksSecretCompatibilityReport({
		betterAuthSecret: input.betterAuthSecret,
		selectRows: async () => {
			const result = await input.pool.query<FederationJwksSecretCompatibilityRow>(
				'select "id", "privateKey", "publicKey" from "app_auth"."jwks" order by "createdAt" desc',
			);
			return result.rows;
		},
	});

	return {
		...report,
		jwksSecretCompatibility,
		status:
			report.status === "provider_verified_routes_exposed" && jwksSecretCompatibility.compatible
				? "provider_verified_routes_exposed"
				: "blocked_before_route_exposure",
	};
}

async function main(): Promise<void> {
	const shouldCheckDatabase = process.argv.includes("--database");
	if (!shouldCheckDatabase) {
		console.log(JSON.stringify(buildFederationRuntimeReadinessReport(), null, 2));
		return;
	}

	const connectionString = process.env.APP_API_OPERATOR_DATABASE_URL?.trim();
	if (!connectionString) {
		throw new Error("APP_API_OPERATOR_DATABASE_URL is required for --database.");
	}
	const { Client } = await import("pg");
	const client = new Client({
		connectionString,
		ssl:
			process.env.APP_API_DATABASE_SSLMODE?.trim() === "disable"
				? false
				: { rejectUnauthorized: false },
	});
	await client.connect();
	try {
		const report = await buildFederationRuntimeReadinessReportWithDatabase({
			betterAuthSecret: process.env.BETTER_AUTH_SECRET,
			pool: client,
		});
		console.log(JSON.stringify(report, null, 2));
		if (report.status !== "provider_verified_routes_exposed") {
			process.exitCode = 1;
		}
	} finally {
		await client.end();
	}
}

if (process.argv[1]?.endsWith("verify-federation-runtime-readiness.ts")) {
	void main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
