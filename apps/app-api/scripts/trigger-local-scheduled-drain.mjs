import process from "node:process";

function parseBaseUrl(argv) {
	const flagIndex = argv.indexOf("--base-url");
	if (flagIndex >= 0) {
		const rawValue = argv[flagIndex + 1]?.trim();
		if (!rawValue) {
			throw new Error("--base-url requires a value");
		}
		return rawValue;
	}

	return process.env.APP_API_BASE_URL?.trim() || "http://127.0.0.1:8787";
}

async function main() {
	const baseUrl = parseBaseUrl(process.argv.slice(2)).replace(/\/$/, "");
	const url = `${baseUrl}/cdn-cgi/handler/scheduled`;
	const response = await fetch(url);
	const body = await response.text();

	console.log(
		JSON.stringify(
			{
				body,
				status: response.status,
				url,
			},
			null,
			2,
		),
	);

	if (!response.ok) {
		process.exitCode = 1;
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
