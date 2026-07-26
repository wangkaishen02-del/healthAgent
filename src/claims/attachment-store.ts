import { randomUUID } from "node:crypto";
import type { ClaimAttachmentCategory, ClaimUpload } from "./types.ts";

const uploadedFiles = new Map<string, { data: Uint8Array; upload: ClaimUpload }>();
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function storeClaimUpload(input: {
  fileName: string;
  mimeType: string;
  data: Uint8Array;
  category: ClaimAttachmentCategory;
}) {
  if (!allowedMimeTypes.has(input.mimeType)) throw new Error("unsupported_file_type");
  if (!input.data.byteLength || input.data.byteLength > MAX_ATTACHMENT_BYTES) throw new Error("invalid_file_size");
  const upload: ClaimUpload = {
    uploadId: randomUUID(),
    fileName: input.fileName.slice(0, 200),
    mimeType: input.mimeType,
    fileSize: input.data.byteLength,
    category: input.category,
    uploadedAt: new Date().toISOString(),
  };
  uploadedFiles.set(upload.uploadId, { data: input.data, upload });
  return upload;
}

export function removeClaimUpload(uploadId: string) {
  return uploadedFiles.delete(uploadId);
}

export function getClaimUpload(uploadId: string) {
  return uploadedFiles.get(uploadId);
}
