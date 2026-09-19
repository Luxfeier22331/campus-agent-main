import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
	ACTIVE_IMAGE_TARGETS,
	type ImageTarget,
	imageWorkspaceClosure,
	isImageSource,
	readImageWorkspaces,
} from "./image-targets.mts";

// Turbo retains test-only workspace dependencies. Keep their manifests for frozen installs,
// but omit their source from the image's compilation layer.
export function pruneImageSources(image: ImageTarget, output: string, root = process.cwd()): void {
	const workspaces = readImageWorkspaces(root);
	const production = new Set(
		imageWorkspaceClosure(image, workspaces).map((workspace) => workspace.directory),
	);
	const full = path.join(output, "full");
	const walk = (directory: string) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const file = path.join(directory, entry.name);
			const relative = path.relative(full, file).split(path.sep).join("/");
			const workspace = workspaces.find((item) => relative.startsWith(`${item.directory}/`));
			if (
				!isImageSource(relative) ||
				(workspace &&
					!production.has(workspace.directory) &&
					relative !== `${workspace.directory}/package.json`)
			) {
				rmSync(file, { recursive: true, force: true });
			} else if (entry.isDirectory()) {
				walk(file);
			}
		}
	};
	walk(full);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const image = process.argv[2];
	const output = process.argv[3];
	if (!(image && output && (ACTIVE_IMAGE_TARGETS as readonly string[]).includes(image))) {
		throw new Error("Expected an image target and Turbo prune output directory");
	}
	pruneImageSources(image as ImageTarget, path.resolve(output));
}
