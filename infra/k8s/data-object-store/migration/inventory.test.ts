import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInventory,
  collectInventory,
  compareInventories,
  kubectlMcCommand,
} from "./inventory.js";

const MULTIPART_ETAG = "0123456789abcdef0123456789abcdef-2";
const VERSION_ID = "11111111-2222-3333-4444-555555555555";

function list(
  lastModified: string,
  etag = MULTIPART_ETAG,
  key = "private/path.json",
  versionId = VERSION_ID,
): string {
  return `${JSON.stringify({
    status: "success",
    type: "file",
    lastModified,
    size: 16,
    key,
    etag,
    versionId,
    versionOrdinal: 1,
  })}\n`;
}

function statObject(
  metadata: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Amz-Meta-Campus-Repro": "multipart-mtime",
    "X-Amz-Meta-Content-Sha256": "a".repeat(64),
  },
  etag = MULTIPART_ETAG,
  name = "path.json",
  versionId = VERSION_ID,
): Record<string, unknown> {
  return {
    status: "success",
    name,
    size: 16,
    etag,
    type: "file",
    metadata,
    versionID: versionId,
  };
}

function stat(
  metadata?: Record<string, string>,
  etag = MULTIPART_ETAG,
  key = "private/path.json",
  versionId = VERSION_ID,
  name = "path.json",
): string {
  return `${JSON.stringify({
    key,
    stat: statObject(metadata, etag, name, versionId),
    versionId,
  })}\n`;
}

function compare(options: {
  sourceEtag?: string;
  sourceTime?: string;
  targetEtag?: string;
  targetMetadata?: Record<string, string>;
  targetTime?: string;
}) {
  const sourceEtag = options.sourceEtag ?? MULTIPART_ETAG;
  const targetEtag = options.targetEtag ?? sourceEtag;
  return compareInventories({
    replicationStart: "2026-08-03T10:05:00.000Z",
    replicationEnd: "2026-08-03T10:10:00.000Z",
    source: buildInventory(
      "campus-agent-source",
      list(options.sourceTime ?? "2026-08-03T10:00:00.000Z", sourceEtag),
      stat(undefined, sourceEtag),
      "source",
    ),
    target: buildInventory(
      "campus-agent-source",
      list(options.targetTime ?? "2026-08-03T10:06:00.000Z", targetEtag),
      stat(options.targetMetadata, targetEtag),
      "target",
    ),
  });
}

test("accepts the documented multipart LastModified exception", () => {
  const result = compare({});
  assert.equal(result.multipartLastModifiedExceptions, 1);
  assert.deepEqual(result.differences, []);
});

test("requires exact LastModified for ordinary PUT versions", () => {
  const etag = "0123456789abcdef0123456789abcdef";
  const result = compare({ sourceEtag: etag, targetEtag: etag });
  assert.deepEqual(result.differences.map(({ field }) => field), ["lastModified"]);
});

test("rejects multipart LastModified outside the replication window", () => {
  const result = compare({ targetTime: "2026-08-03T10:11:00.000Z" });
  assert.deepEqual(result.differences.map(({ field }) => field), ["lastModified"]);
});

test("rejects a multipart LastModified earlier than its source version", () => {
  const result = compare({
    sourceTime: "2026-08-03T10:06:00.000Z",
    targetTime: "2026-08-03T10:05:00.000Z",
  });
  assert.deepEqual(result.differences.map(({ field }) => field), ["lastModified"]);
});

test("reports metadata mismatches without exposing metadata values or object keys", () => {
  const result = compare({
    sourceTime: "2026-08-03T10:00:00.000Z",
    targetMetadata: {
      "Content-Type": "application/json",
      "X-Amz-Meta-Campus-Repro": "different-value",
      "X-Amz-Meta-Content-Sha256": "a".repeat(64),
    },
    targetTime: "2026-08-03T10:00:00.000Z",
  });
  assert.deepEqual(result.differences.map(({ field }) => field), ["userMetadata"]);
  const output = JSON.stringify(result);
  assert.doesNotMatch(output, /private\/path|different-value|multipart-mtime/u);
});

test("rejects a missing stat record for a non-delete version", () => {
  assert.throws(
    () => buildInventory("campus-agent-source", list("2026-08-03T10:00:00Z"), ""),
    /missing a listed object version/u,
  );
});

test("uses the collected full key when mc stat only returns a basename", () => {
  const secondVersionId = "22222222-3333-4444-5555-666666666666";
  const listJsonl =
    list("2026-08-03T10:00:00.000Z", MULTIPART_ETAG, "private/path.json") +
    list(
      "2026-08-03T10:00:00.000Z",
      MULTIPART_ETAG,
      "published/path.json",
      secondVersionId,
    );
  const statJsonl =
    stat(undefined, MULTIPART_ETAG, "private/path.json") +
    stat(undefined, MULTIPART_ETAG, "published/path.json", secondVersionId);

  const inventory = buildInventory("campus-agent-source", listJsonl, statJsonl);
  assert.deepEqual(
    inventory.map(({ key }) => key),
    ["private/path.json", "published/path.json"],
  );
});

test("rejects raw stat output and mismatched envelope versions", () => {
  const listJsonl = list("2026-08-03T10:00:00.000Z");
  assert.throws(
    () =>
      buildInventory(
        "campus-agent-source",
        listJsonl,
        `${JSON.stringify(statObject())}\n`,
      ),
    /key must be a string/u,
  );

  const mismatched = JSON.parse(stat()) as Record<string, unknown>;
  mismatched.versionId = "different-version";
  assert.throws(
    () => buildInventory("campus-agent-source", listJsonl, `${JSON.stringify(mismatched)}\n`),
    /versionId disagrees with stat\.versionID/u,
  );
});

test("rejects duplicate and unlisted stat envelopes", () => {
  const listJsonl = list("2026-08-03T10:00:00.000Z");
  assert.throws(
    () => buildInventory("campus-agent-source", listJsonl, stat() + stat()),
    /duplicate stat results/u,
  );

  const extraVersionId = "22222222-3333-4444-5555-666666666666";
  assert.throws(
    () =>
      buildInventory(
        "campus-agent-source",
        listJsonl,
        stat() + stat(undefined, MULTIPART_ETAG, "private/extra.json", extraVersionId),
      ),
    /object version absent from its list inventory/u,
  );
});

test("collects nested keys as single arguments and skips delete markers", async () => {
  const key = "private/课程 notes/path one.json";
  const deleteMarker = JSON.stringify({
    status: "success",
    type: "file",
    lastModified: "2026-08-03T10:00:01.000Z",
    size: 0,
    key: "private/deleted.json",
    etag: "",
    versionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    versionOrdinal: 2,
    isDeleteMarker: true,
  });
  const calls: string[][] = [];
  const collection = await collectInventory({
    alias: "source",
    bucket: "campus-agent-source",
    runMc: async (args) => {
      calls.push([...args]);
      if (args[0] === "ls") {
        return `${list("2026-08-03T10:00:00.000Z", MULTIPART_ETAG, key)}${deleteMarker}\n`;
      }
      return `${JSON.stringify(statObject())}\n`;
    },
  });

  assert.equal(collection.listedVersions, 2);
  assert.equal(collection.statVersions, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.at(-1), `source/campus-agent-source/${key}`);
  assert.deepEqual(JSON.parse(collection.statJsonl), {
    key,
    stat: statObject(),
    versionId: VERSION_ID,
  });

  const command = kubectlMcCommand("campus-agent-staging", calls[1] ?? []);
  assert.equal(command.command, "kubectl");
  assert.equal(command.args.at(-1), `source/campus-agent-source/${key}`);
});

test("redacts object keys from stat collection failures", async () => {
  const key = "private/sensitive/path.json";
  let calls = 0;
  await assert.rejects(
    collectInventory({
      alias: "source",
      bucket: "campus-agent-source",
      runMc: async () => {
        calls += 1;
        if (calls === 1) {
          return list("2026-08-03T10:00:00.000Z", MULTIPART_ETAG, key);
        }
        throw new Error(`failed to stat ${key}`);
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /stat collection failed for object [0-9a-f]{64}/u);
      assert.doesNotMatch(error.message, /sensitive|private/u);
      return true;
    },
  );
});

test("compares delete markers without requiring stat output", () => {
  const deleteMarker = `${JSON.stringify({
    status: "success",
    type: "file",
    lastModified: "2026-08-03T10:00:00.000Z",
    size: 0,
    key: "private/deleted.json",
    etag: "",
    versionId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    versionOrdinal: 2,
    isDeleteMarker: true,
  })}\n`;
  const inventory = buildInventory("campus-agent-source", deleteMarker, "");
  const result = compareInventories({
    replicationStart: "2026-08-03T10:00:00.000Z",
    replicationEnd: "2026-08-03T10:01:00.000Z",
    source: inventory,
    target: inventory,
  });
  assert.deepEqual(result.differences, []);
  assert.equal(inventory[0]?.deleteMarker, true);
  assert.equal(inventory[0]?.isLatest, true);
});
