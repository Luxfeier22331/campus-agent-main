import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const MULTIPART_ETAG = /^[0-9a-f]{32}-[1-9][0-9]*$/u;

interface ListEntry {
  etag: string;
  isDeleteMarker?: boolean;
  key: string;
  lastModified: string;
  size: number;
  status: string;
  versionId: string;
  versionOrdinal: number;
}

interface StatEntry {
  etag: string;
  metadata: Record<string, string>;
  size: number;
  status: string;
  versionID: string;
}

type MigrationAlias = "source" | "target";

type McRunner = (args: readonly string[]) => Promise<string>;

export interface CollectedInventory {
  listedVersions: number;
  listJsonl: string;
  statJsonl: string;
  statVersions: number;
}

export interface InventoryVersion {
  bucket: string;
  contentSha256: string | null;
  contentType: string | null;
  deleteMarker: boolean;
  etag: string;
  isLatest: boolean;
  key: string;
  lastModified: string;
  size: number;
  userMetadata: Record<string, string>;
  versionId: string;
}

export interface InventoryDifference {
  field: string;
  objectId: string;
  reason: "mismatch" | "missing-target" | "unexpected-target";
}

export interface ComparisonResult {
  differences: InventoryDifference[];
  multipartLastModifiedExceptions: number;
  sourceVersions: number;
  targetVersions: number;
}

function records(jsonl: string, label: string): unknown[] {
  return jsonl
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as unknown;
      } catch (error) {
        throw new Error(`${label}:${index + 1} is not valid JSON`, { cause: error });
      }
    });
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function normalizeEtag(value: string): string {
  return value.replace(/^"|"$/gu, "").toLowerCase();
}

function parseTime(value: string, label: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  return timestamp;
}

function parseList(jsonl: string, label: string): ListEntry[] {
  return records(jsonl, label).map((value, index) => {
    const entry = object(value, `${label}:${index + 1}`);
    if (entry.status !== "success") {
      throw new Error(`${label}:${index + 1} contains an mc error result`);
    }
    const lastModified = string(entry.lastModified, `${label}:${index + 1}.lastModified`);
    parseTime(lastModified, `${label}:${index + 1}.lastModified`);
    return {
      etag: normalizeEtag(string(entry.etag, `${label}:${index + 1}.etag`)),
      isDeleteMarker: entry.isDeleteMarker === true,
      key: string(entry.key, `${label}:${index + 1}.key`),
      lastModified,
      size: number(entry.size, `${label}:${index + 1}.size`),
      status: "success",
      versionId: string(entry.versionId, `${label}:${index + 1}.versionId`),
      versionOrdinal: number(
        entry.versionOrdinal,
        `${label}:${index + 1}.versionOrdinal`,
      ),
    };
  });
}

function parseStat(value: unknown, label: string): StatEntry {
  const entry = object(value, label);
  if (entry.status !== "success") {
    throw new Error(`${label} contains an mc error result`);
  }
  string(entry.name, `${label}.name`);
  const metadataObject = object(entry.metadata, `${label}.metadata`);
  const metadata = Object.fromEntries(
    Object.entries(metadataObject).map(([key, metadataValue]) => [
      key,
      string(metadataValue, `${label}.metadata.${key}`),
    ]),
  );
  return {
    etag: normalizeEtag(string(entry.etag, `${label}.etag`)),
    metadata,
    size: number(entry.size, `${label}.size`),
    status: "success",
    versionID: string(entry.versionID, `${label}.versionID`),
  };
}

function parseStats(jsonl: string, label: string): Map<string, StatEntry> {
  const stats = new Map<string, StatEntry>();
  for (const [index, value] of records(jsonl, label).entries()) {
    const envelopeLabel = `${label}:${index + 1}`;
    const envelope = object(value, envelopeLabel);
    const key = string(envelope.key, `${envelopeLabel}.key`);
    const versionId = string(envelope.versionId, `${envelopeLabel}.versionId`);
    const stat = parseStat(envelope.stat, `${envelopeLabel}.stat`);
    if (stat.versionID !== versionId) {
      throw new Error(`${envelopeLabel} versionId disagrees with stat.versionID`);
    }
    const identity = `${key}\0${versionId}`;
    if (stats.has(identity)) {
      throw new Error(`${label} contains duplicate stat results`);
    }
    stats.set(identity, stat);
  }
  return stats;
}

function metadata(stat: StatEntry): {
  contentSha256: string | null;
  contentType: string | null;
  userMetadata: Record<string, string>;
} {
  let contentType: string | null = null;
  const userMetadata: Record<string, string> = {};
  for (const [rawKey, value] of Object.entries(stat.metadata)) {
    const key = rawKey.toLowerCase();
    if (key === "content-type") {
      contentType = value;
    }
    if (key.startsWith("x-amz-meta-")) {
      userMetadata[key.slice("x-amz-meta-".length)] = value;
    }
  }
  const sortedUserMetadata = Object.fromEntries(
    Object.entries(userMetadata).sort(([left], [right]) => left.localeCompare(right)),
  );
  return {
    contentSha256: sortedUserMetadata["content-sha256"] ?? null,
    contentType,
    userMetadata: sortedUserMetadata,
  };
}

export function buildInventory(
  bucket: string,
  listJsonl: string,
  statJsonl: string,
  label = bucket,
): InventoryVersion[] {
  const listed = parseList(listJsonl, `${label}.ls`);
  const stats = parseStats(statJsonl, `${label}.stat`);
  const latestOrdinal = new Map<string, number>();
  for (const entry of listed) {
    latestOrdinal.set(entry.key, Math.max(latestOrdinal.get(entry.key) ?? 0, entry.versionOrdinal));
  }

  const inventory = listed.map((entry): InventoryVersion => {
    const statIdentity = `${entry.key}\0${entry.versionId}`;
    const stat = stats.get(statIdentity);
    if (entry.isDeleteMarker) {
      if (stat) {
        throw new Error(`${label}.stat unexpectedly contains a delete marker stat`);
      }
      return {
        bucket,
        contentSha256: null,
        contentType: null,
        deleteMarker: true,
        etag: entry.etag,
        isLatest: entry.versionOrdinal === latestOrdinal.get(entry.key),
        key: entry.key,
        lastModified: entry.lastModified,
        size: entry.size,
        userMetadata: {},
        versionId: entry.versionId,
      };
    }
    if (!stat) {
      throw new Error(`${label}.stat is missing a listed object version`);
    }
    stats.delete(statIdentity);
    if (stat.size !== entry.size || stat.etag !== entry.etag) {
      throw new Error(`${label}.stat disagrees with its list inventory`);
    }
    return {
      bucket,
      deleteMarker: false,
      etag: entry.etag,
      isLatest: entry.versionOrdinal === latestOrdinal.get(entry.key),
      key: entry.key,
      lastModified: entry.lastModified,
      size: entry.size,
      versionId: entry.versionId,
      ...metadata(stat),
    };
  });
  if (stats.size > 0) {
    throw new Error(`${label}.stat contains an object version absent from its list inventory`);
  }
  return inventory.sort((left, right) =>
    `${left.key}\0${left.versionId}`.localeCompare(`${right.key}\0${right.versionId}`),
  );
}

function identity(version: InventoryVersion): string {
  return `${version.bucket}\0${version.key}\0${version.versionId}`;
}

function opaqueVersionIdentity(bucket: string, key: string, versionId: string): string {
  return createHash("sha256").update(`${bucket}\0${key}\0${versionId}`).digest("hex");
}

function opaqueIdentity(version: InventoryVersion): string {
  return opaqueVersionIdentity(version.bucket, version.key, version.versionId);
}

function sameMetadata(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function compareInventories(options: {
  replicationEnd: string;
  replicationStart: string;
  source: InventoryVersion[];
  target: InventoryVersion[];
}): ComparisonResult {
  const start = parseTime(options.replicationStart, "replicationStart");
  const end = parseTime(options.replicationEnd, "replicationEnd");
  if (end < start) {
    throw new Error("replicationEnd must not be earlier than replicationStart");
  }
  const source = new Map(options.source.map((version) => [identity(version), version]));
  const target = new Map(options.target.map((version) => [identity(version), version]));
  if (source.size !== options.source.length || target.size !== options.target.length) {
    throw new Error("inventories must not contain duplicate versions");
  }

  const differences: InventoryDifference[] = [];
  let multipartLastModifiedExceptions = 0;
  for (const [key, sourceVersion] of source) {
    const targetVersion = target.get(key);
    const objectId = opaqueIdentity(sourceVersion);
    if (!targetVersion) {
      differences.push({ field: "version", objectId, reason: "missing-target" });
      continue;
    }
    target.delete(key);
    const fields: Array<[string, boolean]> = [
      ["deleteMarker", sourceVersion.deleteMarker === targetVersion.deleteMarker],
      ["isLatest", sourceVersion.isLatest === targetVersion.isLatest],
      ["size", sourceVersion.size === targetVersion.size],
      ["etag", sourceVersion.etag === targetVersion.etag],
      ["contentType", sourceVersion.contentType === targetVersion.contentType],
      ["content-sha256", sourceVersion.contentSha256 === targetVersion.contentSha256],
      ["userMetadata", sameMetadata(sourceVersion.userMetadata, targetVersion.userMetadata)],
    ];
    for (const [field, matches] of fields) {
      if (!matches) {
        differences.push({ field, objectId, reason: "mismatch" });
      }
    }

    const sourceTime = parseTime(sourceVersion.lastModified, "source.lastModified");
    const targetTime = parseTime(targetVersion.lastModified, "target.lastModified");
    if (sourceTime !== targetTime) {
      const allowedMultipartChange =
        !sourceVersion.deleteMarker &&
        MULTIPART_ETAG.test(sourceVersion.etag) &&
        sourceVersion.etag === targetVersion.etag &&
        targetTime >= sourceTime &&
        targetTime >= start &&
        targetTime <= end;
      if (allowedMultipartChange) {
        multipartLastModifiedExceptions += 1;
      } else {
        differences.push({ field: "lastModified", objectId, reason: "mismatch" });
      }
    }
  }
  for (const targetVersion of target.values()) {
    differences.push({
      field: "version",
      objectId: opaqueIdentity(targetVersion),
      reason: "unexpected-target",
    });
  }
  return {
    differences: differences.sort((left, right) =>
      `${left.objectId}\0${left.field}`.localeCompare(`${right.objectId}\0${right.field}`),
    ),
    multipartLastModifiedExceptions,
    sourceVersions: options.source.length,
    targetVersions: options.target.length,
  };
}

function required(values: Record<string, string | boolean | undefined>, name: string): string {
  const value = values[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function migrationAlias(value: string): MigrationAlias {
  if (value !== "source" && value !== "target") {
    throw new Error("--alias must be source or target");
  }
  return value;
}

export async function collectInventory(options: {
  alias: MigrationAlias;
  bucket: string;
  runMc: McRunner;
}): Promise<CollectedInventory> {
  const target = `${options.alias}/${options.bucket}`;
  const listJsonl = await options.runMc([
    "ls",
    "--recursive",
    "--versions",
    "--json",
    target,
  ]);
  const listed = parseList(listJsonl, `${options.alias}.${options.bucket}.ls`);
  const statRecords: string[] = [];
  for (const entry of listed) {
    if (entry.isDeleteMarker) {
      continue;
    }
    let values: unknown[];
    try {
      const statJsonl = await options.runMc([
        "stat",
        "--version-id",
        entry.versionId,
        "--json",
        `${target}/${entry.key}`,
      ]);
      values = records(statJsonl, `${options.alias}.${options.bucket}.stat`);
      if (values.length !== 1) {
        throw new Error("mc stat must return exactly one JSON record");
      }
      parseStat(values[0], `${options.alias}.${options.bucket}.stat`);
    } catch (error) {
      throw new Error(
        `stat collection failed for object ${opaqueVersionIdentity(
          options.bucket,
          entry.key,
          entry.versionId,
        )}`,
        { cause: error },
      );
    }
    statRecords.push(
      JSON.stringify({
        key: entry.key,
        stat: values[0],
        versionId: entry.versionId,
      }),
    );
  }
  return {
    listedVersions: listed.length,
    listJsonl,
    statJsonl: statRecords.length > 0 ? `${statRecords.join("\n")}\n` : "",
    statVersions: statRecords.length,
  };
}

export function kubectlMcCommand(
  namespace: string,
  mcArgs: readonly string[],
): { args: string[]; command: string } {
  return {
    args: [
      "exec",
      "--namespace",
      namespace,
      "object-store-migration-operator",
      "--container",
      "mc",
      "--",
      "mc",
      ...mcArgs,
    ],
    command: "kubectl",
  };
}

function runCommand(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} exited with status ${code ?? "unknown"}`));
        return;
      }
      resolveCommand(stdout);
    });
  });
}

async function writePrivateFile(path: string, contents: string): Promise<void> {
  await writeFile(path, contents, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      alias: { type: "string" },
      bucket: { type: "string" },
      "ls-output": { type: "string" },
      namespace: { type: "string" },
      "replication-end": { type: "string" },
      "replication-start": { type: "string" },
      "source-ls": { type: "string" },
      "source-stat": { type: "string" },
      "stat-output": { type: "string" },
      "target-ls": { type: "string" },
      "target-stat": { type: "string" },
    },
    strict: true,
  });
  if (positionals.length !== 1 || (positionals[0] !== "collect" && positionals[0] !== "compare")) {
    throw new Error("expected exactly one command: collect or compare");
  }
  const bucket = required(values, "bucket");
  if (positionals[0] === "collect") {
    const namespace = required(values, "namespace");
    const alias = migrationAlias(required(values, "alias"));
    const listOutput = required(values, "ls-output");
    const statOutput = required(values, "stat-output");
    if (resolve(listOutput) === resolve(statOutput)) {
      throw new Error("--ls-output and --stat-output must be different files");
    }
    const collection = await collectInventory({
      alias,
      bucket,
      runMc: (args) => {
        const command = kubectlMcCommand(namespace, args);
        return runCommand(command.command, command.args);
      },
    });
    await Promise.all([
      writePrivateFile(listOutput, collection.listJsonl),
      writePrivateFile(statOutput, collection.statJsonl),
    ]);
    process.stdout.write(
      `${JSON.stringify({
        listedVersions: collection.listedVersions,
        statVersions: collection.statVersions,
      })}\n`,
    );
    return;
  }
  const [sourceList, sourceStat, targetList, targetStat] = await Promise.all(
    ["source-ls", "source-stat", "target-ls", "target-stat"].map((name) =>
      readFile(required(values, name), "utf8"),
    ),
  );
  const result = compareInventories({
    replicationEnd: required(values, "replication-end"),
    replicationStart: required(values, "replication-start"),
    source: buildInventory(bucket, sourceList, sourceStat, "source"),
    target: buildInventory(bucket, targetList, targetStat, "target"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.differences.length > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
