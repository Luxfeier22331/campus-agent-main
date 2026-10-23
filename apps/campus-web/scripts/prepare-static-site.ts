/**
 * Prepare the built Campus Web client for static hosting (GitHub Pages).
 *
 * The Cloudflare Worker normally injects the campus runtime config into the HTML
 * shell at request time and serves `/index.html` for every app route. A static
 * host does neither, so this script:
 *   1. injects the runtime config + auth config scripts into the HTML shell,
 *   2. copies the shell to `404.html` so deep links such as `/map` resolve,
 *   3. writes `.nojekyll` so underscore-prefixed paths belong to the site.
 *
 * Usage: tsx scripts/prepare-static-site.ts <outputRoot> <siteOrigin>
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const CAMPUS_RUNTIME_CONFIG_SCRIPT_ID = "__CAMPUS_RUNTIME_CONFIG__";
const AUTH_RUNTIME_CONFIG_SCRIPT_ID = "__CAMPUS_AUTH_CONFIG__";

/**
 * App routes that the Cloudflare Worker serves from the HTML shell. A static
 * host has no such rewriting, so each one gets a real directory with its own
 * `index.html`; that keeps `/<route>` a 200 response instead of leaning on the
 * 404 fallback.
 */
const STATIC_SHELL_ROUTES = [
	"map",
	"transport",
	"dining",
	"groups",
	"feedback",
	"notices",
	"account",
	"account/login",
	"account/register",
	"account/forgot-password",
	"account/reset-password",
	"account/reset-link-sent",
	"account/reset-complete",
	"account/verify-email",
	"account/verify-email/result",
	"account/change-password",
	"account/deletion",
	"account/settings/account",
	"account/settings/security",
	"account/settings/memory",
	"account/federation/consent",
	"account/federation/error",
	"legal/terms",
	"legal/privacy",
] as const;

function main(): void {
	const [outputRootArgument, siteOriginArgument] = process.argv.slice(2);
	if (!(outputRootArgument && siteOriginArgument)) {
		throw new Error("Usage: prepare-static-site.ts <outputRoot> <siteOrigin>");
	}
	const outputRoot = resolve(outputRootArgument);
	const siteOrigin = new URL(siteOriginArgument).origin;
	const indexPath = resolve(outputRoot, "index.html");
	if (!existsSync(indexPath)) {
		throw new Error(`Static site shell is missing: ${indexPath}`);
	}

	const html = readFileSync(indexPath, "utf8");
	if (html.includes(`id="${CAMPUS_RUNTIME_CONFIG_SCRIPT_ID}"`)) {
		throw new Error("Static site shell already carries a runtime config.");
	}

	// The static site has no backend, so the account surface stays on the same
	// origin and Turnstile is left unconfigured; only these values are required
	// for the shell to boot.
	const campusConfig = JSON.stringify({
		accountUrl: new URL("/account", siteOrigin).toString(),
		deploymentLane: null,
		loginUrl: new URL("/account/login", siteOrigin).toString(),
	}).replace(/</g, "\\u003c");
	const authConfig = JSON.stringify({
		authReturnOrigins: {},
		turnstileAppearance: "interaction-only",
		turnstileExecution: "render",
		turnstileSiteKey: null,
	}).replace(/</g, "\\u003c");
	const injected = `<script id="${CAMPUS_RUNTIME_CONFIG_SCRIPT_ID}" type="application/json">${campusConfig}</script><script id="${AUTH_RUNTIME_CONFIG_SCRIPT_ID}" type="application/json">${authConfig}</script>`;

	const shell = html.includes("</body>")
		? html.replace("</body>", `${injected}</body>`)
		: `${html}${injected}`;
	writeFileSync(indexPath, shell, "utf8");

	// `404.html` is what GitHub Pages serves for unknown paths; using the app
	// shell keeps client-side routes and refresh working.
	copyFileSync(indexPath, resolve(outputRoot, "404.html"));
	writeFileSync(resolve(outputRoot, ".nojekyll"), "", "utf8");

	// Give every app route its own shell so direct visits return 200 instead of
	// the 404 fallback.
	for (const route of STATIC_SHELL_ROUTES) {
		const routeIndex = resolve(outputRoot, route, "index.html");
		mkdirSync(dirname(routeIndex), { recursive: true });
		copyFileSync(indexPath, routeIndex);
	}

	console.log(
		JSON.stringify({
			authConfigInjected: shell.includes(AUTH_RUNTIME_CONFIG_SCRIPT_ID),
			fallbackWritten: existsSync(resolve(outputRoot, "404.html")),
			outputRoot,
			routeShellsWritten: STATIC_SHELL_ROUTES.length,
			runtimeConfigInjected: shell.includes(CAMPUS_RUNTIME_CONFIG_SCRIPT_ID),
			siteOrigin,
		}),
	);
}

main();
