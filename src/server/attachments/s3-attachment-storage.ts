import "server-only";

import {
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";
import type {
  AttachmentScanDecision,
  AttachmentStorage,
  AttachmentUploadRequest,
  AttachmentUploadTarget,
  StoredAttachmentObject,
} from "./attachment-storage";

const uploadTtlSeconds = 5 * 60;
const downloadTtlSeconds = 5 * 60;
const guardDutyTagKey = "GuardDutyMalwareScanStatus";

const configurationSchema = z.strictObject({
  region: z.string().trim().min(1),
  bucket: z
    .string()
    .trim()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/),
});

type S3StorageConfiguration = z.infer<typeof configurationSchema>;
type Signer = typeof getSignedUrl;

function encodedContentDisposition(filename: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export class S3AttachmentStorage implements AttachmentStorage {
  constructor(
    private readonly configuration: S3StorageConfiguration,
    private readonly client = new S3Client({
      region: configuration.region,
      // A browser supplies the file body after signing, so the server cannot
      // precompute the SDK's default CRC32 payload checksum.
      requestChecksumCalculation: "WHEN_REQUIRED",
    }),
    private readonly signer: Signer = getSignedUrl,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async createUploadTarget(
    request: AttachmentUploadRequest,
  ): Promise<AttachmentUploadTarget> {
    const command = new PutObjectCommand({
      Bucket: this.configuration.bucket,
      Key: request.storageKey,
      ContentType: request.mediaType,
      ContentLength: request.byteSize,
      IfNoneMatch: "*",
      ServerSideEncryption: "AES256",
    });
    const url = await this.signer(this.client, command, {
      expiresIn: uploadTtlSeconds,
    });
    return {
      url,
      headers: {
        "content-type": request.mediaType,
        "if-none-match": "*",
        "x-amz-server-side-encryption": "AES256",
      },
      expiresAt: new Date(
        this.clock().getTime() + uploadTtlSeconds * 1_000,
      ).toISOString(),
    };
  }

  async inspectObject(storageKey: string): Promise<StoredAttachmentObject> {
    const result = await this.client.send(
      new HeadObjectCommand({
        Bucket: this.configuration.bucket,
        Key: storageKey,
      }),
    );
    if (
      typeof result.ContentLength !== "number" ||
      typeof result.ContentType !== "string"
    ) {
      throw new Error("ATTACHMENT_OBJECT_METADATA_MISSING");
    }
    return {
      byteSize: result.ContentLength,
      mediaType: result.ContentType,
    };
  }

  async getScanDecision(
    storageKey: string,
  ): Promise<AttachmentScanDecision> {
    const result = await this.client.send(
      new GetObjectTaggingCommand({
        Bucket: this.configuration.bucket,
        Key: storageKey,
      }),
    );
    const status = result.TagSet?.find(
      (tag) => tag.Key === guardDutyTagKey,
    )?.Value;
    if (status === "NO_THREATS_FOUND") {
      return "READY";
    }
    if (
      status === "THREATS_FOUND" ||
      status === "UNSUPPORTED" ||
      status === "ACCESS_DENIED" ||
      status === "FAILED"
    ) {
      return "REJECTED";
    }
    return "PENDING";
  }

  async createDownloadUrl(input: Readonly<{
    storageKey: string;
    mediaType: string;
    filename: string;
  }>): Promise<string> {
    return this.signer(
      this.client,
      new GetObjectCommand({
        Bucket: this.configuration.bucket,
        Key: input.storageKey,
        ResponseContentType: input.mediaType,
        ResponseContentDisposition: encodedContentDisposition(
          input.filename,
        ),
      }),
      { expiresIn: downloadTtlSeconds },
    );
  }
}

export function createAttachmentStorageFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AttachmentStorage | null {
  if (environment.ATTACHMENT_STORAGE_ENABLED?.trim() !== "1") {
    return null;
  }
  const configuration = configurationSchema.parse({
    region: environment.AWS_REGION,
    bucket: environment.AWS_S3_ATTACHMENT_BUCKET,
  });
  return new S3AttachmentStorage(configuration);
}
