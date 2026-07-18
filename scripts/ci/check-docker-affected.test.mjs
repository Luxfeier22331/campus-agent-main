import assert from "node:assert/strict";
import test from "node:test";
import {
	describeDockerCheck,
	dockerBuildCommand,
	validateDockerContext,
} from "./check-docker-affected.mjs";
import { ALL_IMAGES, IMAGE_DEFINITIONS } from "./ci-surfaces.mjs";

test("keeps every declared image workspace visible to Docker", () => {
	assert.doesNotThrow(() => validateDockerContext(ALL_IMAGES));
});

test("rejects unknown images", () => {
	assert.throws(() => validateDockerContext(["unknown-image"]), /unknown image/u);
	assert.throws(() => describeDockerCheck("unknown-image"), /unknown image/u);
});

test("declares one existing check stage for every image", () => {
	for (const image of ALL_IMAGES) {
		const check = describeDockerCheck(image);
		assert.equal(check.dockerfile, IMAGE_DEFINITIONS[image].dockerfile);
		assert.equal(check.target, IMAGE_DEFINITIONS[image].checkTarget);
		assert.ok(check.target);
		const command = dockerBuildCommand(image);
		assert.equal(command.includes("--target"), true);
		assert.equal(command.includes("--output=type=cacheonly"), true);
		assert.equal(command.includes("--push"), false);
		assert.equal(command.includes("--load"), false);
	}
});
