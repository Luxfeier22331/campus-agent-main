import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { AccountAdminContractSchema } from "../src/account-admin.ts";
import { EmailAccessContractSchema } from "../src/email-access.ts";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const contracts = [
	{
		id: "account-admin.v1",
		schema: AccountAdminContractSchema,
		title: "Account administration contract",
	},
	{
		id: "email-access.v1",
		schema: EmailAccessContractSchema,
		title: "Email access administration contract",
	},
] as const;

function generatedSchema(input: { id: string; schema: z.ZodType; title: string }): string {
	const schema = z.toJSONSchema(input.schema, { io: "output", reused: "inline" });
	const raw = `${JSON.stringify(
		{
			...schema,
			$id: `https://campus-agent.local/schemas/${input.id}.schema.json`,
			title: input.title,
		},
		null,
		"\t",
	)}\n`;
	const outputPath = resolve(packageRoot, `schemas/${input.id}.schema.json`);
	const formatted = spawnSync(
		"pnpm",
		["exec", "biome", "format", "--stdin-file-path", outputPath],
		{
			encoding: "utf8",
			input: raw,
			shell: process.platform === "win32",
		},
	);
	if (formatted.error) {
		throw formatted.error;
	}
	if (formatted.status !== 0 || !formatted.stdout) {
		throw new Error(formatted.stderr || `Biome could not format ${input.id}.`);
	}
	return formatted.stdout;
}

export function generateAccountContracts(input: { check: boolean }): void {
	for (const contract of contracts) {
		const outputPath = resolve(packageRoot, `schemas/${contract.id}.schema.json`);
		const expected = generatedSchema(contract);
		if (input.check) {
			if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== expected) {
				throw new Error(`generated ${contract.id} schema is out of sync`);
			}
			continue;
		}
		writeFileSync(outputPath, expected, "utf8");
	}
}

function main(argv: string[]): void {
	const check = argv.length === 1 && argv[0] === "--check";
	if (!(argv.length === 0 || check)) {
		throw new Error(`unsupported arguments: ${argv.join(" ")}`);
	}
	generateAccountContracts({ check });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	try {
		main(process.argv.slice(2));
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
