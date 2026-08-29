import "server-only";

import type { AttachmentStorage } from "./attachment-storage";
import {
  createLocalAttachmentStorageFromEnvironment,
  LocalFilesystemAttachmentStorage,
} from "./local-filesystem-attachment-storage";
import { createAttachmentStorageFromEnvironment as createBlobStorage } from "./vercel-blob-attachment-storage";

export type AttachmentUploadStrategy = "presigned" | "server-received";

/**
 * Which backend is in play, and therefore how the browser has to upload.
 *
 * Vercel Blob issues a presigned token and the browser writes to Blob directly;
 * a local disk has no such thing, so the bytes come through this application.
 * The client cannot infer this — asking it to would mean shipping the Blob
 * client to a deployment that has no Blob — so the surface that needs it is
 * told explicitly.
 */
export function attachmentUploadStrategy(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AttachmentUploadStrategy | null {
  if (createLocalAttachmentStorageFromEnvironment(environment)) {
    return "server-received";
  }
  return createBlobStorage(environment) ? "presigned" : null;
}

/**
 * Local disk wins when both are configured: a box that was given an attachment
 * directory is meant to use it, and silently preferring a remote store would
 * put student files somewhere the operator did not choose.
 */
export function createAttachmentStorage(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AttachmentStorage | null {
  return (
    createLocalAttachmentStorageFromEnvironment(environment) ??
    createBlobStorage(environment)
  );
}

/** The write path exists only on the local backend; Blob is written by the browser. */
export function createServerReceivedAttachmentStorage(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): LocalFilesystemAttachmentStorage | null {
  return createLocalAttachmentStorageFromEnvironment(environment);
}
