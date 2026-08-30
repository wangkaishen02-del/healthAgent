import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ClaimAttachmentCategory, ClaimUpload } from "./types.ts";

const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const uploadIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const attachmentDirectory = resolve(
  process.env.CLAIM_ATTACHMENT_DIR?.trim() || join(process.cwd(), "data", "claim-attachments"),
);

function attachmentPaths(uploadId: string) {
  if (!uploadIdPattern.test(uploadId)) return null;
  return {
    data: join(attachmentDirectory, `${uploadId}.bin`),
    metadata: join(attachmentDirectory, `${uploadId}.json`),
  };
}

function isStoredUpload(value: unknown, uploadId: string): value is ClaimUpload {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ClaimUpload>;
  return item.uploadId === uploadId
    && typeof item.fileName === "string"
    && typeof item.mimeType === "string"
    && typeof item.fileSize === "number"
    && typeof item.category === "string"
    && typeof item.uploadedAt === "string";
}

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
  const paths = attachmentPaths(upload.uploadId);
  if (!paths) throw new Error("invalid_upload_id");
  mkdirSync(attachmentDirectory, { recursive: true });
  const temporaryDataPath = `${paths.data}.${randomUUID()}.tmp`;
  const temporaryMetadataPath = `${paths.metadata}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryDataPath, input.data);
    writeFileSync(temporaryMetadataPath, JSON.stringify(upload), "utf8");
    renameSync(temporaryDataPath, paths.data);
    renameSync(temporaryMetadataPath, paths.metadata);
  } catch (error) {
    rmSync(temporaryDataPath, { force: true });
    rmSync(temporaryMetadataPath, { force: true });
    rmSync(paths.data, { force: true });
    rmSync(paths.metadata, { force: true });
    throw error;
  }
  return upload;
}

export function removeClaimUpload(uploadId: string) {
  const paths = attachmentPaths(uploadId);
  if (!paths) return false;
  const existed = existsSync(paths.data) || existsSync(paths.metadata);
  rmSync(paths.data, { force: true });
  rmSync(paths.metadata, { force: true });
  return existed;
}

export function getClaimUpload(uploadId: string) {
  const paths = attachmentPaths(uploadId);
  if (!paths || !existsSync(paths.data) || !existsSync(paths.metadata)) return undefined;
  try {
    const upload = JSON.parse(readFileSync(paths.metadata, "utf8")) as unknown;
    if (!isStoredUpload(upload, uploadId)) return undefined;
    const data = readFileSync(paths.data);
    if (data.byteLength !== upload.fileSize) return undefined;
    return { data: new Uint8Array(data), upload };
  } catch {
    return undefined;
  }
}
