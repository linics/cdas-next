import {
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import type { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createAttachmentStorageFromEnvironment,
  S3AttachmentStorage,
} from "./s3-attachment-storage";

describe("S3 attachment storage", () => {
  it("stays disabled until explicitly configured", () => {
    expect(createAttachmentStorageFromEnvironment({})).toBeNull();
  });

  it("signs a create-only upload with exact declared metadata", async () => {
    const signedCommands: unknown[] = [];
    const signer: typeof getSignedUrl = async (_client, command) => {
      signedCommands.push(command);
      return "https://upload.example.test/signed";
    };
    const client = { send: vi.fn() } as unknown as S3Client;
    const storage = new S3AttachmentStorage(
      { region: "ap-southeast-1", bucket: "cdas-attachments-test" },
      client,
      signer,
      () => new Date("2026-08-24T00:00:00.000Z"),
    );

    await expect(
      storage.createUploadTarget({
        storageKey: "submissions/a/b",
        mediaType: "application/pdf",
        byteSize: 2_048,
      }),
    ).resolves.toEqual({
      url: "https://upload.example.test/signed",
      headers: {
        "content-type": "application/pdf",
        "if-none-match": "*",
        "x-amz-server-side-encryption": "AES256",
      },
      expiresAt: "2026-08-24T00:05:00.000Z",
    });
    const command = signedCommands[0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: "cdas-attachments-test",
      Key: "submissions/a/b",
      ContentType: "application/pdf",
      ContentLength: 2_048,
      IfNoneMatch: "*",
      ServerSideEncryption: "AES256",
    });
  });

  it("produces a browser upload URL without a checksum for an unknown body", async () => {
    const storage = new S3AttachmentStorage(
      { region: "ap-southeast-1", bucket: "cdas-attachments-test" },
      new (await import("@aws-sdk/client-s3")).S3Client({
        region: "ap-southeast-1",
        credentials: {
          accessKeyId: "test-access-key",
          secretAccessKey: "test-secret-key",
        },
        requestChecksumCalculation: "WHEN_REQUIRED",
      }),
      undefined,
      () => new Date("2026-08-24T00:00:00.000Z"),
    );

    const target = await storage.createUploadTarget({
      storageKey: "submissions/a/browser-body",
      mediaType: "image/png",
      byteSize: 12,
    });
    const url = new URL(target.url);
    expect(url.searchParams.has("x-amz-checksum-crc32")).toBe(false);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain(
      "if-none-match",
    );
  });

  it("maps only a clean GuardDuty tag to ready", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        ContentLength: 12,
        ContentType: "image/png",
      })
      .mockResolvedValueOnce({
        TagSet: [
          {
            Key: "GuardDutyMalwareScanStatus",
            Value: "NO_THREATS_FOUND",
          },
        ],
      })
      .mockResolvedValueOnce({
        TagSet: [
          {
            Key: "GuardDutyMalwareScanStatus",
            Value: "THREATS_FOUND",
          },
        ],
      });
    const storage = new S3AttachmentStorage(
      { region: "ap-southeast-1", bucket: "cdas-attachments-test" },
      { send } as unknown as S3Client,
    );

    await expect(storage.inspectObject("object-key")).resolves.toEqual({
      byteSize: 12,
      mediaType: "image/png",
    });
    expect(send.mock.calls[0]![0]).toBeInstanceOf(HeadObjectCommand);
    await expect(storage.getScanDecision("object-key")).resolves.toBe(
      "READY",
    );
    await expect(storage.getScanDecision("object-key")).resolves.toBe(
      "REJECTED",
    );
    expect(send.mock.calls[1]![0]).toBeInstanceOf(GetObjectTaggingCommand);
  });

  it("signs downloads with a UTF-8 attachment filename", async () => {
    const signedCommands: unknown[] = [];
    const signer: typeof getSignedUrl = async (_client, command) => {
      signedCommands.push(command);
      return "https://download.example.test/signed";
    };
    const storage = new S3AttachmentStorage(
      { region: "ap-southeast-1", bucket: "cdas-attachments-test" },
      { send: vi.fn() } as unknown as S3Client,
      signer,
    );

    await expect(
      storage.createDownloadUrl({
        storageKey: "submissions/a/b",
        mediaType: "image/jpeg",
        filename: "观察.jpg",
      }),
    ).resolves.toBe("https://download.example.test/signed");
    const command = signedCommands[0] as GetObjectCommand;
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect(command.input.ResponseContentDisposition).toContain(
      encodeURIComponent("观察.jpg"),
    );
  });
});
