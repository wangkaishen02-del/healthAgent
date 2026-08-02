from __future__ import annotations

import io
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Annotated, Any, Literal

import numpy as np
import fitz
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError
from rapidocr import RapidOCR

from .extractors import OcrLine, classify_document, extract_structured


logger = logging.getLogger(__name__)
MAX_FILE_BYTES = int(os.getenv("OCR_MAX_FILE_BYTES", str(12 * 1024 * 1024)))
MAX_IMAGE_PIXELS = int(os.getenv("OCR_MAX_IMAGE_PIXELS", "30000000"))
MAX_PDF_PAGES = int(os.getenv("OCR_MAX_PDF_PAGES", "10"))
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/bmp", "image/tiff", "application/pdf"}
DocumentType = Literal["auto", "id_card", "medical_invoice"]

engine: RapidOCR | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global engine
    engine = RapidOCR()
    yield
    engine = None


app = FastAPI(
    title="HealthAgent OCR",
    version="1.0.0",
    description="本地医疗票据和身份证 OCR 服务",
    lifespan=lifespan,
)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok" if engine is not None else "starting",
        "engine": "RapidOCR",
        "ready": engine is not None,
    }


def _decode_image(content: bytes) -> np.ndarray:
    try:
        image = Image.open(io.BytesIO(content))
        image.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(status_code=415, detail="无法解析图片，请上传清晰的 JPEG、PNG、WebP、BMP 或 TIFF") from exc

    width, height = image.size
    if width * height > MAX_IMAGE_PIXELS:
        raise HTTPException(status_code=413, detail="图片像素过大，请压缩后重试")

    image = ImageOps.exif_transpose(image).convert("RGB")
    return np.asarray(image)[:, :, ::-1].copy()


def _decode_document(content: bytes, content_type: str | None) -> list[np.ndarray]:
    if content_type != "application/pdf":
        return [_decode_image(content)]

    try:
        document = fitz.open(stream=content, filetype="pdf")
    except Exception as exc:
        raise HTTPException(status_code=415, detail="无法解析 PDF 文件") from exc

    try:
        if document.page_count < 1:
            raise HTTPException(status_code=400, detail="PDF 文件没有可识别页面")
        if document.page_count > MAX_PDF_PAGES:
            raise HTTPException(status_code=413, detail=f"PDF 不能超过 {MAX_PDF_PAGES} 页")

        images: list[np.ndarray] = []
        for page in document:
            pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False, colorspace=fitz.csRGB)
            if pixmap.width * pixmap.height > MAX_IMAGE_PIXELS:
                raise HTTPException(status_code=413, detail="PDF 页面像素过大")
            rgb = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, 3)
            images.append(rgb[:, :, ::-1].copy())
        return images
    finally:
        document.close()


def _normalize_result(result: Any, page: int = 1) -> list[OcrLine]:
    if result is None:
        return []

    if hasattr(result, "txts"):
        texts = list(result.txts) if result.txts is not None else []
        scores = list(result.scores) if result.scores is not None else []
        boxes = list(result.boxes) if result.boxes is not None else []
        return [
            OcrLine(
                text=str(text).strip(),
                score=float(scores[index]) if index < len(scores) else 0.0,
                box=np.asarray(boxes[index]).astype(float).tolist() if index < len(boxes) else [],
                page=page,
            )
            for index, text in enumerate(texts)
            if str(text).strip()
        ]

    rows = result[0] if isinstance(result, tuple) else result
    normalized: list[OcrLine] = []
    for row in rows or []:
        if not isinstance(row, (list, tuple)) or len(row) < 3:
            continue
        normalized.append(
            OcrLine(
                text=str(row[1]).strip(),
                score=float(row[2]),
                box=np.asarray(row[0]).astype(float).tolist(),
                page=page,
            )
        )
    return normalized


async def _read_upload(file: UploadFile) -> bytes:
    if file.content_type and file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=415, detail="当前仅支持 JPEG、PNG、WebP、BMP、TIFF 和 PDF")

    content = await file.read(MAX_FILE_BYTES + 1)
    if not content:
        raise HTTPException(status_code=400, detail="上传文件为空")
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail=f"文件不能超过 {MAX_FILE_BYTES // 1024 // 1024}MB")
    return content


@app.post("/v1/ocr")
async def recognize(
    file: Annotated[UploadFile, File(description="待识别图片")],
    document_type: Annotated[DocumentType, Form()] = "auto",
) -> dict[str, Any]:
    if engine is None:
        raise HTTPException(status_code=503, detail="OCR 模型正在初始化")

    images = _decode_document(await _read_upload(file), file.content_type)
    started_at = time.perf_counter()
    try:
        lines = [
            line
            for page, image in enumerate(images, start=1)
            for line in _normalize_result(engine(image), page)
        ]
    except Exception as exc:
        logger.exception("OCR recognition failed")
        raise HTTPException(status_code=500, detail="OCR 识别失败") from exc

    inferred_type, classification_confidence = classify_document(lines)
    resolved_type = inferred_type if document_type == "auto" else document_type
    structured = extract_structured(lines, resolved_type)
    elapsed_ms = round((time.perf_counter() - started_at) * 1000, 1)

    return {
        "documentType": resolved_type,
        "classificationConfidence": classification_confidence if document_type == "auto" else 1.0,
        "text": "\n".join(line.text for line in lines),
        "lines": [
            {"text": line.text, "confidence": round(line.score, 4), "page": line.page, "box": line.box}
            for line in lines
        ],
        "structured": structured,
        "meta": {
            "engine": "RapidOCR",
            "elapsedMs": elapsed_ms,
            "lineCount": len(lines),
            "pageCount": len(images),
        },
    }


@app.post("/v1/ocr/id-card")
async def recognize_id_card(
    file: Annotated[UploadFile, File(description="身份证正面或背面图片")],
) -> dict[str, Any]:
    return await recognize(file, "id_card")


@app.post("/v1/ocr/medical-invoice")
async def recognize_medical_invoice(
    file: Annotated[UploadFile, File(description="医疗票据图片")],
) -> dict[str, Any]:
    return await recognize(file, "medical_invoice")
