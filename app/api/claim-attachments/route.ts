import { NextRequest, NextResponse } from "next/server";
import { removeClaimUpload, storeClaimUpload } from "../../../src/claims/service";
import type { ClaimAttachmentCategory } from "../../../src/claims/types";

const categories: ClaimAttachmentCategory[] = ["application", "identity", "medical", "invoice", "bank", "other"];

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const file = form.get("file");
  const category = form.get("category");
  if (!(file instanceof File) || !categories.includes(category as ClaimAttachmentCategory)) {
    return NextResponse.json({ message: "invalid_attachment" }, { status: 400 });
  }
  try {
    const upload = storeClaimUpload({
      fileName: file.name,
      mimeType: file.type,
      data: new Uint8Array(await file.arrayBuffer()),
      category: category as ClaimAttachmentCategory,
    });
    return NextResponse.json(upload, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "attachment_upload_failed";
    return NextResponse.json({ message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const uploadId = new URL(request.url).searchParams.get("uploadId");
  if (!uploadId) return NextResponse.json({ message: "uploadId is required" }, { status: 400 });
  return removeClaimUpload(uploadId)
    ? NextResponse.json({ success: true })
    : NextResponse.json({ message: "attachment_not_found" }, { status: 404 });
}
