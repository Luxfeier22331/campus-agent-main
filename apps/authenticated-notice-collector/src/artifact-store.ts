import { createHash } from "node:crypto";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface StoredArtifactRef {
  bucket: string;
  objectKey: string;
  contentSha256: string;
  byteSize: number;
  etag: string | null;
  versionId: string | null;
}

export interface AuthenticatedNoticeArtifactStore {
  readonly storageProvider: "object_store";

  putObject(input: {
    objectKey: string;
    data: Uint8Array;
    contentType: string;
    metadata?: Record<string, string>;
  }): Promise<StoredArtifactRef>;
}

export interface AuthenticatedNoticeObjectStoreEnvironment {
  OBJECT_STORE_ACCESS_KEY?: string;
  OBJECT_STORE_BUCKET_SOURCE?: string;
  OBJECT_STORE_ENDPOINT?: string;
  OBJECT_STORE_REGION?: string;
  OBJECT_STORE_SECRET_KEY?: string;
  OBJECT_STORE_SOURCE_ACCESS_KEY?: string;
  OBJECT_STORE_SOURCE_SECRET_KEY?: string;
}

class S3AuthenticatedNoticeArtifactStore implements AuthenticatedNoticeArtifactStore {
  readonly storageProvider = "object_store" as const;
  private readonly bucket: string;
  private readonly client: Pick<S3Client, "send">;

  constructor(input: {
    bucket: string;
    client: Pick<S3Client, "send">;
  }) {
    this.bucket = input.bucket;
    this.client = input.client;
  }

  async putObject(input: {
    objectKey: string;
    data: Uint8Array;
    contentType: string;
    metadata?: Record<string, string>;
  }): Promise<StoredArtifactRef> {
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.objectKey,
        Body: input.data,
        ContentType: input.contentType,
        Metadata: input.metadata,
      }),
    );
    return {
      bucket: this.bucket,
      objectKey: input.objectKey,
      contentSha256: createHash("sha256").update(input.data).digest("hex"),
      byteSize: input.data.byteLength,
      etag: result.ETag ?? null,
      versionId: result.VersionId ?? null,
    };
  }
}

export function createAuthenticatedNoticeArtifactStoreFromEnv(
  env: AuthenticatedNoticeObjectStoreEnvironment = process.env,
): AuthenticatedNoticeArtifactStore | undefined {
  const endpoint = env.OBJECT_STORE_ENDPOINT?.trim();
  const accessKey =
    env.OBJECT_STORE_SOURCE_ACCESS_KEY?.trim() || env.OBJECT_STORE_ACCESS_KEY?.trim();
  const secretKey =
    env.OBJECT_STORE_SOURCE_SECRET_KEY?.trim() || env.OBJECT_STORE_SECRET_KEY?.trim();
  const configuredCount = [endpoint, accessKey, secretKey].filter(Boolean).length;

  if (configuredCount === 0) {
    return undefined;
  }
  if (!endpoint || !accessKey || !secretKey) {
    throw new Error(
      "OBJECT_STORE_ENDPOINT plus a complete source-bucket credential pair are required. Use OBJECT_STORE_SOURCE_ACCESS_KEY/OBJECT_STORE_SOURCE_SECRET_KEY or shared OBJECT_STORE_ACCESS_KEY/OBJECT_STORE_SECRET_KEY.",
    );
  }

  return new S3AuthenticatedNoticeArtifactStore({
    bucket: env.OBJECT_STORE_BUCKET_SOURCE?.trim() || "campus-rag-source",
    client: new S3Client({
      endpoint,
      region: env.OBJECT_STORE_REGION?.trim() || "us-east-1",
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle: true,
    }),
  });
}
