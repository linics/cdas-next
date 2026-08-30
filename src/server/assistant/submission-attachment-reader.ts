import "server-only";

import { inflateRawSync } from "node:zlib";
import { generateText, type LanguageModel } from "ai";
import type { PrismaClient } from "../../generated/prisma/client";
import type { CommandContext } from "../commands/command-context";
// The same ceiling the reservation enforced. Kept as one constant: a second
// copy here would keep the old limit the day the policy raises it, and every
// larger attachment would fail to read for no visible reason.
import { MAX_ATTACHMENT_BYTES } from "../../domain/submission/attachment-policy";
import {
  getAuthorizedCurrentRevisionAttachmentDownload,
  SubmissionAttachmentAccessError,
} from "../attachments/submission-attachment-access";
import {
  createAttachmentStorage,
} from "../attachments/attachment-storage-factory";
import type { AttachmentStorage } from "../attachments/attachment-storage";
import type { ActivityAssistantConfig } from "./assistant-config";
import { createDeepSeekAttachmentVisionModel } from "./deepseek-provider";
import {
  attachmentTranscriptionInstructions,
  attachmentTranscriptionMaxOutputTokens,
  attachmentTranscriptionPrompt,
} from "../../domain/assistant/attachment-vision-model";

const MAX_EXTRACTED_CODE_POINTS = 12_000;

// These limits are deliberately below the attachment's 20 MiB transport
// ceiling. They bound the work a document parser may ask the process to do,
// rather than relying on the parser's final string being small after a ZIP has
// already expanded in memory.
const MAX_DOCX_ENTRIES = 512;
const MAX_DOCX_ENTRY_UNCOMPRESSED_BYTES = 8 * 1024 * 1024;
const MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

/**
 * Check the ZIP central directory before Mammoth gets a chance to inflate an
 * entry. Mammoth uses JSZip internally and does not expose an uncompressed
 * size budget, so this check is the expansion boundary for DOCX files.
 */
function assertBoundedDocxArchive(bytes: Uint8Array): void {
  const minimumEndOfCentralDirectoryLength = 22;
  if (bytes.byteLength < minimumEndOfCentralDirectoryLength) {
    throw new Error("DOCX_ARCHIVE_INVALID");
  }

  // A ZIP comment can be up to 65535 bytes. Search only that bounded tail so
  // a malicious byte sequence elsewhere cannot make this scan unbounded.
  const searchStart = Math.max(
    0,
    bytes.byteLength - minimumEndOfCentralDirectoryLength - 65_535,
  );
  let endOfCentralDirectory = -1;
  for (
    let offset = bytes.byteLength - minimumEndOfCentralDirectoryLength;
    offset >= searchStart;
    offset -= 1
  ) {
    if (readUint32LE(bytes, offset) === ZIP_EOCD_SIGNATURE) {
      endOfCentralDirectory = offset;
      break;
    }
  }
  if (endOfCentralDirectory < 0) {
    throw new Error("DOCX_ARCHIVE_INVALID");
  }

  const diskNumber = readUint16LE(bytes, endOfCentralDirectory + 4);
  const centralDirectoryDisk = readUint16LE(bytes, endOfCentralDirectory + 6);
  const entriesOnDisk = readUint16LE(bytes, endOfCentralDirectory + 8);
  const totalEntries = readUint16LE(bytes, endOfCentralDirectory + 10);
  const centralDirectorySize = readUint32LE(
    bytes,
    endOfCentralDirectory + 12,
  );
  const centralDirectoryOffset = readUint32LE(
    bytes,
    endOfCentralDirectory + 16,
  );

  // ZIP64 and split archives are not needed for a <=20 MiB DOCX. Rejecting
  // them avoids treating sentinel values as real sizes or offsets.
  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== totalEntries ||
    totalEntries === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff ||
    totalEntries > MAX_DOCX_ENTRIES
  ) {
    throw new Error("DOCX_ARCHIVE_LIMIT_EXCEEDED");
  }

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  if (
    centralDirectoryOffset > bytes.byteLength ||
    centralDirectoryEnd > bytes.byteLength ||
    centralDirectoryEnd > endOfCentralDirectory
  ) {
    throw new Error("DOCX_ARCHIVE_INVALID");
  }

  let cursor = centralDirectoryOffset;
  let totalUncompressedBytes = 0;
  for (let entryNumber = 0; entryNumber < totalEntries; entryNumber += 1) {
    if (
      cursor + 46 > centralDirectoryEnd ||
      readUint32LE(bytes, cursor) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE
    ) {
      throw new Error("DOCX_ARCHIVE_INVALID");
    }

    const flags = readUint16LE(bytes, cursor + 8);
    const compressionMethod = readUint16LE(bytes, cursor + 10);
    const compressedSize = readUint32LE(bytes, cursor + 20);
    const uncompressedSize = readUint32LE(bytes, cursor + 24);
    const filenameLength = readUint16LE(bytes, cursor + 28);
    const extraLength = readUint16LE(bytes, cursor + 30);
    const commentLength = readUint16LE(bytes, cursor + 32);
    const localHeaderOffset = readUint32LE(bytes, cursor + 42);

    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      (flags & 1) !== 0 ||
      (compressionMethod !== 0 && compressionMethod !== 8) ||
      uncompressedSize > MAX_DOCX_ENTRY_UNCOMPRESSED_BYTES
    ) {
      throw new Error("DOCX_ARCHIVE_LIMIT_EXCEEDED");
    }

    const priorUncompressedBytes = totalUncompressedBytes;
    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error("DOCX_ARCHIVE_LIMIT_EXCEEDED");
    }

    // Validate and inspect the actual local entry before Mammoth/JSZip can
    // inflate it. A central-directory size is metadata supplied by the file;
    // the local bytes are the expansion boundary we can enforce ourselves.
    if (
      localHeaderOffset + 30 > bytes.byteLength ||
      readUint32LE(bytes, localHeaderOffset) !== ZIP_LOCAL_FILE_SIGNATURE
    ) {
      throw new Error("DOCX_ARCHIVE_INVALID");
    }
    const localFlags = readUint16LE(bytes, localHeaderOffset + 6);
    const localCompressionMethod = readUint16LE(
      bytes,
      localHeaderOffset + 8,
    );
    const localCompressedSize = readUint32LE(bytes, localHeaderOffset + 18);
    const localUncompressedSize = readUint32LE(bytes, localHeaderOffset + 22);
    const localFilenameLength = readUint16LE(bytes, localHeaderOffset + 26);
    const localExtraLength = readUint16LE(bytes, localHeaderOffset + 28);
    const dataOffset =
      localHeaderOffset + 30 + localFilenameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (
      (localFlags & 1) !== 0 ||
      localCompressionMethod !== compressionMethod ||
      dataOffset > bytes.byteLength ||
      dataEnd > bytes.byteLength ||
      dataEnd > centralDirectoryOffset ||
      ((localFlags & 8) === 0 &&
        (localCompressedSize !== compressedSize ||
          localUncompressedSize !== uncompressedSize))
    ) {
      throw new Error("DOCX_ARCHIVE_INVALID");
    }

    const compressedData = bytes.subarray(dataOffset, dataEnd);
    let actualUncompressedSize: number;
    if (compressionMethod === 0) {
      actualUncompressedSize = compressedData.byteLength;
    } else {
      try {
        actualUncompressedSize = inflateRawSync(compressedData, {
          maxOutputLength:
            Math.min(
              MAX_DOCX_ENTRY_UNCOMPRESSED_BYTES,
              MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES - priorUncompressedBytes,
            ),
        }).byteLength;
      } catch {
        throw new Error("DOCX_ARCHIVE_LIMIT_EXCEEDED");
      }
    }
    if (
      actualUncompressedSize > MAX_DOCX_ENTRY_UNCOMPRESSED_BYTES ||
      actualUncompressedSize >
        MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES - priorUncompressedBytes
    ) {
      throw new Error("DOCX_ARCHIVE_LIMIT_EXCEEDED");
    }
    if (actualUncompressedSize !== uncompressedSize) {
      throw new Error("DOCX_ARCHIVE_INVALID");
    }

    const recordLength = 46 + filenameLength + extraLength + commentLength;
    cursor += recordLength;
    if (cursor > centralDirectoryEnd) {
      throw new Error("DOCX_ARCHIVE_INVALID");
    }
  }

  if (cursor !== centralDirectoryEnd) {
    throw new Error("DOCX_ARCHIVE_INVALID");
  }
}

export type FormalAttachmentForSuggestion = Readonly<{
  id: string;
  kind: "IMAGE" | "PDF" | "WORD";
  mediaType: string;
}>;

export type FormalRevisionAttachmentScope = Readonly<{
  submissionId: string;
  submissionRevisionId: string;
  submissionRevisionNumber: number;
}>;

export type SubmissionAttachmentReading = Readonly<{
  attachmentId: string;
  status: "READABLE" | "UNREADABLE";
  method: "VISION" | "DOCX_TEXT" | "UNSUPPORTED" | "FAILED";
  content: string | null;
  truncated: boolean;
  note: string | null;
}>;

export class SubmissionAttachmentReaderError extends Error {
  constructor(public readonly code: "NOT_FOUND") {
    super(code);
    this.name = "SubmissionAttachmentReaderError";
  }
}

type AttachmentReaderDependencies = Readonly<{
  createStorage: () => AttachmentStorage | null;
  authorize: typeof getAuthorizedCurrentRevisionAttachmentDownload;
  createVisionModel: (
    config: ActivityAssistantConfig,
  ) => LanguageModel;
  describeImage: (
    model: LanguageModel,
    bytes: Uint8Array,
    mediaType: string,
  ) => Promise<string>;
  extractDocxText: (bytes: Uint8Array) => Promise<string>;
}>;

async function readStream(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_ATTACHMENT_BYTES) {
        throw new Error("ATTACHMENT_READ_LIMIT_EXCEEDED");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function boundedText(value: string): Readonly<{
  content: string;
  truncated: boolean;
}> {
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  const codePoints = [...normalized];
  if (codePoints.length <= MAX_EXTRACTED_CODE_POINTS) {
    return { content: normalized, truncated: false };
  }
  return {
    content: codePoints.slice(0, MAX_EXTRACTED_CODE_POINTS).join(""),
    truncated: true,
  };
}

/**
 * Exported so the real prompt, budget and model can be probed against a real
 * image rather than an approximation of them.
 */
export async function describeImage(
  model: LanguageModel,
  bytes: Uint8Array,
  mediaType: string,
): Promise<string> {
  const result = await generateText({
    model,
    instructions: attachmentTranscriptionInstructions,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: attachmentTranscriptionPrompt },
          { type: "file", data: bytes, mediaType },
        ],
      },
    ],
    maxOutputTokens: attachmentTranscriptionMaxOutputTokens,
    timeout: 45_000,
  });
  return result.text;
}

/** Exported so the real library can be exercised against a real DOCX fixture. */
export async function extractDocxText(bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error("DOCX_RAW_SIZE_LIMIT_EXCEEDED");
  }
  assertBoundedDocxArchive(bytes);
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({
    buffer: Buffer.from(bytes),
  });
  return result.value;
}

const defaultDependencies: AttachmentReaderDependencies = {
  createStorage: createAttachmentStorage,
  authorize: getAuthorizedCurrentRevisionAttachmentDownload,
  createVisionModel: createDeepSeekAttachmentVisionModel,
  describeImage,
  extractDocxText,
};

function unreadable(
  attachmentId: string,
  method: SubmissionAttachmentReading["method"],
  note: string,
): SubmissionAttachmentReading {
  return {
    attachmentId,
    status: "UNREADABLE",
    method,
    content: null,
    truncated: false,
    note,
  };
}

/**
 * Read only the immutable attachments named by the currently authorized formal
 * revision. Each ID is re-authorized through a stricter resource query that
 * binds it to the exact still-current revision; storage keys and filenames
 * never reach a model. This is an internal drafting boundary, not a global
 * Agent tool.
 */
export async function readSubmissionAttachmentsForSuggestion(
  database: PrismaClient,
  context: CommandContext,
  config: ActivityAssistantConfig,
  scope: FormalRevisionAttachmentScope,
  attachments: readonly FormalAttachmentForSuggestion[],
  dependencies: AttachmentReaderDependencies = defaultDependencies,
): Promise<readonly SubmissionAttachmentReading[]> {
  if (attachments.length === 0) return [];

  const storage = dependencies.createStorage();
  let visionModel: LanguageModel | null = null;
  const readings: SubmissionAttachmentReading[] = [];

  for (const candidate of attachments) {
    let authorized: Awaited<ReturnType<typeof dependencies.authorize>>;
    try {
      authorized = await dependencies.authorize(database, context, {
        attachmentId: candidate.id,
        submissionId: scope.submissionId,
        submissionRevisionId: scope.submissionRevisionId,
        submissionRevisionNumber: scope.submissionRevisionNumber,
      });
    } catch (error) {
      if (error instanceof SubmissionAttachmentAccessError) {
        throw new SubmissionAttachmentReaderError("NOT_FOUND");
      }
      throw error;
    }

    if (
      authorized.id !== candidate.id ||
      authorized.mediaType !== candidate.mediaType
    ) {
      throw new SubmissionAttachmentReaderError("NOT_FOUND");
    }
    if (candidate.kind === "PDF") {
      // PDF.js materializes a decoded page content stream before its public
      // text stream yields the first chunk, so output/page counters cannot stop
      // a small high-expansion PDF from exhausting this process. Until the
      // parser runs behind a proven process-level resource boundary, keep PDF
      // available for the authorized human preview/download path but never feed
      // it to the drafting model.
      readings.push(
        unreadable(
          candidate.id,
          "UNSUPPORTED",
          "PDF 自动文本解析暂未启用，教师需查看原件后判断。",
        ),
      );
      continue;
    }
    if (!storage) {
      readings.push(
        unreadable(
          candidate.id,
          "FAILED",
          "附件存储当前不可用，教师需查看原件后判断。",
        ),
      );
      continue;
    }

    try {
      const download = await storage.getDownload(authorized.storageKey);
      const bytes = await readStream(download.stream);
      let rawText: string;
      let method: SubmissionAttachmentReading["method"];

      if (candidate.kind === "IMAGE") {
        visionModel ??= dependencies.createVisionModel(config);
        rawText = await dependencies.describeImage(
          visionModel,
          bytes,
          authorized.mediaType,
        );
        method = "VISION";
      } else if (
        authorized.mediaType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ) {
        rawText = await dependencies.extractDocxText(bytes);
        method = "DOCX_TEXT";
      } else {
        readings.push(
          unreadable(
            candidate.id,
            "UNSUPPORTED",
            "旧版 .doc 暂不解析，教师需查看原件后判断。",
          ),
        );
        continue;
      }

      const bounded = boundedText(rawText);
      if (!bounded.content) {
        readings.push(
          unreadable(
            candidate.id,
            method,
            "附件没有得到可核验内容，教师需查看原件后判断。",
          ),
        );
        continue;
      }
      readings.push({
        attachmentId: candidate.id,
        status: "READABLE",
        method,
        content: bounded.content,
        truncated: bounded.truncated,
        note: bounded.truncated
          ? "内容超过本次读取上限，仅使用前 12000 个 Unicode 字符。"
          : null,
      });
    } catch {
      readings.push(
        unreadable(
          candidate.id,
          "FAILED",
          "附件读取或解析失败，教师需查看原件后判断。",
        ),
      );
    }
  }

  return readings;
}
