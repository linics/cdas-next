import "server-only";

/**
 * The only thing standing between stored bytes and what the database claims
 * they are. Every storage backend must run the same check on the same bytes —
 * two copies of this would drift, and the one that drifts is the one that lets
 * a renamed file through.
 */
const signatureLength = 12;

export function hasPrefix(bytes: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

export function isExpectedSignature(mediaType: string, bytes: Uint8Array): boolean {
  switch (mediaType) {
    case "image/jpeg":
      return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
    case "image/png":
      return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/webp":
      return (
        hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        hasPrefix(bytes.slice(8), [0x57, 0x45, 0x42, 0x50])
      );
    case "application/pdf":
      return hasPrefix(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case "application/msword":
      return hasPrefix(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return hasPrefix(bytes, [0x50, 0x4b, 0x03, 0x04]);
    default:
      return false;
  }
}

export async function readPrefix(
  stream: ReadableStream<Uint8Array>,
  maximumBytes = signatureLength,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maximumBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maximumBytes - total;
      const chunk = value.slice(0, remaining);
      chunks.push(chunk);
      total += chunk.byteLength;
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
