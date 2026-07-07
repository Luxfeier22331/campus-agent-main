import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const sourceRoot = path.resolve(__dirname, "../src");

function listSourceFiles(directory: string): string[] {
	const entries = readdirSync(directory, { withFileTypes: true });
	return entries.flatMap((entry) => {
		const absolutePath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			return listSourceFiles(absolutePath);
		}
		if (entry.isFile() && entry.name.endsWith(".ts")) {
			return [absolutePath];
		}
		return [];
	});
}

function collectRelativeImportSpecifiers(filePath: string): string[] {
	const sourceText = readFileSync(filePath, "utf8");
	const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.ES2022, true);
	const specifiers: string[] = [];

	function visit(node: ts.Node): void {
		if (
			(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
			node.moduleSpecifier &&
			ts.isStringLiteral(node.moduleSpecifier)
		) {
			specifiers.push(node.moduleSpecifier.text);
		}
		if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword &&
			node.arguments.length === 1
		) {
			const [specifier] = node.arguments;
			if (ts.isStringLiteral(specifier)) {
				specifiers.push(specifier.text);
			}
		}
		ts.forEachChild(node, visit);
	}

	visit(sourceFile);
	return specifiers.filter(
		(specifier) => specifier.startsWith("./") || specifier.startsWith("../"),
	);
}

describe("internal portal source collector Node ESM package", () => {
	it("uses explicit .js extensions for relative source imports emitted into dist", () => {
		const violations = listSourceFiles(sourceRoot).flatMap((filePath) =>
			collectRelativeImportSpecifiers(filePath)
				.filter((specifier) => !specifier.endsWith(".js"))
				.map((specifier) => `${path.relative(sourceRoot, filePath)} -> ${specifier}`),
		);

		expect(violations).toEqual([]);
	});
});
