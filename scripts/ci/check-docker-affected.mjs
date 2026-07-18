import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { IMAGE_DEFINITIONS } from "./ci-surfaces.mjs";

function discoverPackages() {
	const packages = new Map();
	const roots = ["apps", "jobs", "packages"];
	for (const root of roots) {
		const pending = [root];
		while (pending.length > 0) {
			const directory = pending.pop();
			if (!(directory && existsSync(directory))) {
				continue;
			}
			const manifest = join(directory, "package.json");
			if (existsSync(manifest)) {
				const parsed = JSON.parse(readFileSync(manifest, "utf8"));
				if (parsed.name) {
					packages.set(parsed.name, { directory, manifest: parsed });
				}
				continue;
			}
			for (const entry of readdirSync(directory, { withFileTypes: true })) {
				if (entry.isDirectory() && !entry.name.startsWith(".")) {
					pending.push(join(directory, entry.name));
				}
			}
		}
	}
	return packages;
}

function workspaceClosure(packageNames, packages) {
	const selected = new Set();
	const pending = packageNames.filter((name) => packages.has(name));
	while (pending.length > 0) {
		const name = pending.pop();
		if (!name || selected.has(name)) {
			continue;
		}
		selected.add(name);
		const manifest = packages.get(name)?.manifest ?? {};
		for (const dependencies of [
			manifest.dependencies,
			manifest.devDependencies,
			manifest.optionalDependencies,
		]) {
			for (const dependency of Object.keys(dependencies ?? {})) {
				if (packages.has(dependency)) {
					pending.push(dependency);
				}
			}
		}
	}
	return selected;
}

function readAllowPatterns() {
	return readFileSync(".dockerignore", "utf8")
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter((line) => line.startsWith("!") && line.length > 1)
		.map((line) => line.slice(1).replace(/^\.\//u, ""));
}

function isAllowed(path, patterns) {
	return patterns.some((pattern) => {
		if (pattern.endsWith("/**")) {
			return path.startsWith(pattern.slice(0, -3));
		}
		if (pattern.endsWith("/")) {
			return path.startsWith(pattern);
		}
		return path === pattern;
	});
}

export function validateDockerContext(imageNames) {
	const packages = discoverPackages();
	const allowPatterns = readAllowPatterns();
	for (const image of imageNames) {
		const definition = IMAGE_DEFINITIONS[image];
		if (!definition) {
			throw new Error(`unknown image: ${image}`);
		}
		for (const packageName of workspaceClosure(definition.packages, packages)) {
			const packagePath = packages.get(packageName)?.directory;
			if (packagePath && !isAllowed(`${packagePath}/package.json`, allowPatterns)) {
				throw new Error(`${image} requires ${packagePath}, but .dockerignore excludes it`);
			}
		}
	}
}

export function describeDockerCheck(imageName) {
	const definition = IMAGE_DEFINITIONS[imageName];
	if (!definition) {
		throw new Error(`unknown image: ${imageName}`);
	}
	if (!definition.checkTarget) {
		throw new Error(`missing Docker check target: ${imageName}`);
	}
	return {
		dockerfile: definition.dockerfile,
		target: definition.checkTarget,
	};
}

export function dockerBuildCommand(imageName) {
	const definition = describeDockerCheck(imageName);
	return [
		"buildx",
		"build",
		"--file",
		definition.dockerfile,
		"--target",
		definition.target,
		"--provenance=false",
		"--sbom=false",
		"--output=type=cacheonly",
		".",
	];
}

function runUniqueDockerChecks(imageNames, callback) {
	const checked = new Set();
	for (const image of imageNames) {
		const definition = describeDockerCheck(image);
		const key = `${definition.dockerfile}:${definition.target}`;
		if (!checked.has(key)) {
			checked.add(key);
			callback(image, definition);
		}
	}
}

function main(args) {
	if (args[0] === "--describe" && args.length === 2) {
		process.stdout.write(`${JSON.stringify(describeDockerCheck(args[1]))}\n`);
		return;
	}
	if (args[0] === "--build" && args.length === 2) {
		const imageNames = JSON.parse(args[1]);
		validateDockerContext(imageNames);
		runUniqueDockerChecks(imageNames, (image) => {
			execFileSync("docker", dockerBuildCommand(image), { stdio: "inherit" });
		});
		return;
	}
	if (args.length !== 1) {
		throw new Error(
			"expected one JSON image list argument, --build <JSON image list>, or --describe <image>",
		);
	}
	const imageNames = JSON.parse(args[0]);
	validateDockerContext(imageNames);
	runUniqueDockerChecks(imageNames, (_image, definition) => {
		const command = ["buildx", "build", "--check", "--file", definition.dockerfile];
		command.push("--target", definition.target);
		command.push(".");
		execFileSync("docker", command, { stdio: "inherit" });
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	main(process.argv.slice(2));
}
