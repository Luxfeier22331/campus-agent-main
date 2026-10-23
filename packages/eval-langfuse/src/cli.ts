#!/usr/bin/env node

import type { JsonObject } from "./json";
import { settingsFromEnv } from "./settings";
import { verifyLangfuseOnlineTraceEvidence } from "./trace-evidence";

type ParsedArgs = Record<string, string | boolean>;

export async function main(argv: string[]): Promise<number> {
	const [command, ...rest] = argv;
	const args = parseArgs(rest);
	try {
		const result = await handleCommand(command ?? "", args);
		if (args.json) {
			console.log(JSON.stringify(result, null, 2));
		} else {
			console.log(JSON.stringify(result));
		}
		return 0;
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

async function handleCommand(command: string, args: ParsedArgs): Promise<JsonObject> {
	if (command === "verify-trace") {
		return verifyLangfuseOnlineTraceEvidence({
			expectedRequestId: stringArg(args, "request-id"),
			settings: settingsFromArgs(args),
			traceId: stringArg(args, "trace-id"),
		});
	}
	throw new Error(`Unknown command: ${command}`);
}

function parseArgs(argv: string[]): ParsedArgs {
	const parsed: ParsedArgs = {};
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];
		if (!token) {
			throw new Error("Unexpected empty argument");
		}
		if (!token.startsWith("--")) {
			throw new Error(`Unexpected argument: ${token}`);
		}
		const key = token.slice(2);
		if (key === "json") {
			parsed[key] = true;
			continue;
		}
		const value = argv[index + 1];
		if (!value || value.startsWith("--")) {
			throw new Error(`${token} requires a value`);
		}
		parsed[key] = value;
		index += 1;
	}
	return parsed;
}

function stringArg(args: ParsedArgs, key: string): string {
	return required(optionalArg(args, key), key);
}

function optionalArg(args: ParsedArgs, key: string): string | null {
	const value = args[key];
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberArg(args: ParsedArgs, key: string): number | null {
	const value = optionalArg(args, key);
	if (!value) {
		return null;
	}
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${key} must be a positive integer`);
	}
	return parsed;
}

function required(value: string | null, field: string): string {
	if (!value) {
		throw new Error(`${field} is required`);
	}
	return value;
}

function settingsFromArgs(args: ParsedArgs) {
	return settingsFromEnv({ timeoutSeconds: numberArg(args, "timeout-seconds") ?? 10 });
}

if (import.meta.url === `file://${process.argv[1]}`) {
	process.exitCode = await main(process.argv.slice(2));
}
