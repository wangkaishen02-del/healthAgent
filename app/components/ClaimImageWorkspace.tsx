"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ClaimOcrResult, ClaimUpload } from "../../src/claims/types";
import { apiFetch } from "../../src/api/client";

type ClaimImageWorkspaceProps = {
  open: boolean;
  caseNo?: string;
  attachments: ClaimUpload[];
  busy?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  uploadInHeader?: boolean;
  onClose: () => void;
  onUpload: (files: FileList | null) => void;
  onRemove?: (uploadId: string) => void;
  onSelectionChange?: (uploadId: string) => void;
  selectedUploadId?: string;
};

function formatFileSize(value: number) {
  return value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;
}

const ocrStatusLabels: Record<ClaimOcrResult["status"], string> = {
  queued: "OCR 排队中",
  processing: "OCR 识别中",
  succeeded: "OCR 已完成",
  failed: "OCR 失败",
};

function useAttachmentObjectUrl(uploadId?: string) {
  const [objectUrl, setObjectUrl] = useState("");
  useEffect(() => {
    if (!uploadId) { setObjectUrl(""); return; }
    setObjectUrl("");
    let active = true;
    let nextUrl = "";
    void apiFetch(`/api/claim-attachments?uploadId=${encodeURIComponent(uploadId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("attachment_preview_failed");
        nextUrl = URL.createObjectURL(await response.blob());
        if (active) setObjectUrl(nextUrl);
        else URL.revokeObjectURL(nextUrl);
      })
      .catch(() => { if (active) setObjectUrl(""); });
    return () => {
      active = false;
      if (nextUrl) URL.revokeObjectURL(nextUrl);
    };
  }, [uploadId]);
  return objectUrl;
}

function AttachmentThumbnail({ item }: { item: ClaimUpload }) {
  const objectUrl = useAttachmentObjectUrl(item.mimeType === "application/pdf" ? undefined : item.uploadId);
  if (item.mimeType === "application/pdf") return <b>PDF</b>;
  return objectUrl ? <img src={objectUrl} alt="" /> : <b>加载中</b>;
}

export default function ClaimImageWorkspace({
  open,
  attachments,
  busy = false,
  disabled = false,
  readOnly = false,
  uploadInHeader = false,
  onClose,
  onUpload,
  onRemove,
  onSelectionChange,
  selectedUploadId,
}: ClaimImageWorkspaceProps) {
  const [selectedId, setSelectedId] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [ocrOpen, setOcrOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [ocrResults, setOcrResults] = useState<Record<string, ClaimOcrResult>>({});
  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const controlledSelectedId = selectedUploadId && attachments.some((item) => item.uploadId === selectedUploadId)
    ? selectedUploadId
    : "";
  const selected = useMemo(
    () => attachments.find((item) => item.uploadId === controlledSelectedId)
      ?? attachments.find((item) => item.uploadId === selectedId)
      ?? attachments[0]
      ?? null,
    [attachments, controlledSelectedId, selectedId],
  );
  const selectedOcr = selected ? ocrResults[selected.uploadId] ?? selected.ocr : undefined;
  const previewUrl = useAttachmentObjectUrl(selected?.uploadId);

  useEffect(() => {
    const next = Object.fromEntries(
      attachments.flatMap((item) => item.ocr ? [[item.uploadId, item.ocr]] : []),
    );
    setOcrResults((current) => ({ ...current, ...next }));
  }, [attachments]);

  useEffect(() => {
    if (!attachments.length) setSelectedId("");
    else if (controlledSelectedId && selectedId !== controlledSelectedId) setSelectedId(controlledSelectedId);
    else if (!attachments.some((item) => item.uploadId === selectedId)) setSelectedId(attachments[0].uploadId);
  }, [attachments, controlledSelectedId, selectedId]);

  useEffect(() => {
    setPreviewFailed(false);
    setOcrOpen(false);
    setRotation(0);
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setDragging(false);
    dragState.current = null;
  }, [selected?.uploadId]);

  useEffect(() => {
    const nextId = selected?.uploadId ?? "";
    if (nextId !== selectedUploadId) onSelectionChange?.(nextId);
  }, [onSelectionChange, selected?.uploadId, selectedUploadId]);

  useEffect(() => {
    if (!open || !selected) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const response = await apiFetch(`/api/claim-attachments/ocr?uploadId=${encodeURIComponent(selected.uploadId)}`);
        if (!response.ok || cancelled) return;
        const result = await response.json() as ClaimOcrResult;
        setOcrResults((current) => ({ ...current, [selected.uploadId]: result }));
        if (result.status === "queued" || result.status === "processing") {
          timer = setTimeout(() => void refresh(), 1200);
        }
      } catch {
        // 影像预览仍可使用，OCR 状态会在下次选择影像时重新查询。
      }
    };
    void refresh();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, selected?.uploadId]);

  useEffect(() => {
    if (!fullscreen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fullscreen]);

  useEffect(() => {
    if (!open) setFullscreen(false);
  }, [open]);

  const isPdf = selected?.mimeType === "application/pdf";
  const selectPrevious = () => {
    if (!attachments.length) return;
    const currentIndex = Math.max(0, attachments.findIndex((item) => item.uploadId === selected?.uploadId));
    const previousId = attachments[(currentIndex - 1 + attachments.length) % attachments.length].uploadId;
    setSelectedId(previousId);
    onSelectionChange?.(previousId);
  };
  const selectNext = () => {
    if (!attachments.length) return;
    const currentIndex = Math.max(0, attachments.findIndex((item) => item.uploadId === selected?.uploadId));
    const nextId = attachments[(currentIndex + 1) % attachments.length].uploadId;
    setSelectedId(nextId);
    onSelectionChange?.(nextId);
  };
  const zoomBy = (amount: number) => {
    setScale((value) => Math.min(6, Math.max(0.5, value + amount)));
  };
  const resetPosition = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };
  const stopDragging = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragState.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragState.current = null;
    setDragging(false);
  };
  const retryOcr = async () => {
    if (!selected) return;
    const response = await apiFetch("/api/claim-attachments/ocr/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId: selected.uploadId }),
    });
    if (!response.ok) return;
    const result = await response.json() as ClaimOcrResult;
    setOcrResults((current) => ({ ...current, [selected.uploadId]: result }));
  };
  const workspace = (
    <aside className={`claim-image-workspace ${fullscreen ? "fullscreen" : ""}`} aria-hidden={!open}>
      <div className="claim-image-workspace-header">
        <div className="claim-image-workspace-summary">
          <div className="section-title">影像件</div>
          <small>{attachments.length} 件</small>
        </div>
        {selected ? <div className="claim-image-header-preview-tools">
          <div className="claim-image-header-file">
            <strong title={selected.fileName}>{selected.fileName}</strong>
            <small>{formatFileSize(selected.fileSize)}{selectedOcr ? ` · ${ocrStatusLabels[selectedOcr.status]}` : ""}</small>
          </div>
          <div className="claim-image-preview-actions">
            <button type="button" className="secondary-button" onClick={() => setRotation((value) => value - 90)}>左旋</button>
            <button type="button" className="secondary-button" onClick={() => setRotation((value) => value + 90)}>右旋</button>
            <button type="button" className="secondary-button" disabled={scale <= 0.5} onClick={() => zoomBy(-0.25)}>缩小</button>
            <button type="button" className="secondary-button claim-image-scale" title="恢复居中完整显示" onClick={resetPosition}>{Math.round(scale * 100)}%</button>
            <button type="button" className="secondary-button" disabled={scale >= 6} onClick={() => zoomBy(0.25)}>放大</button>
            <button type="button" onClick={selectPrevious} disabled={attachments.length <= 1}>上一张</button>
            <button type="button" onClick={selectNext} disabled={attachments.length <= 1}>下一张</button>
            <button type="button" className="secondary-button" onClick={() => setOcrOpen((value) => !value)}>{ocrOpen ? "收起 OCR" : "查看 OCR"}</button>
            {!readOnly && onRemove ? <button type="button" className="danger-link" disabled={disabled || busy} onClick={() => onRemove(selected.uploadId)}>删除</button> : null}
          </div>
        </div> : null}
        <div className="claim-image-header-end-actions">
          {!readOnly && uploadInHeader ? <label className={`claim-upload-button ${disabled || busy ? "disabled" : ""}`}>
            {busy ? "上传中…" : "上传影像件"}
            <input
              disabled={disabled || busy}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(event) => {
                onUpload(event.target.files);
                event.target.value = "";
              }}
            />
          </label> : null}
          <button type="button" className="secondary-button" onClick={() => setFullscreen((value) => !value)}>{fullscreen ? "退出全屏" : "全屏"}</button>
          <button type="button" className="secondary-button" onClick={() => { setFullscreen(false); onClose(); }}>收起影像件</button>
        </div>
      </div>

      {!readOnly && !uploadInHeader ? <div className="claim-image-upload-bar">
        <label className={`claim-upload-button ${disabled || busy ? "disabled" : ""}`}>
          {busy ? "上传中…" : "上传影像件"}
          <input
            disabled={disabled || busy}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(event) => {
              onUpload(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      </div> : null}

      <div className="claim-image-browser">
        <div
          className="claim-image-thumbnails"
          onWheel={(event) => {
            const distance = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
            if (!distance) return;
            event.currentTarget.scrollLeft += distance;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {attachments.length ? attachments.map((item) => {
            return (
              <button
                type="button"
                key={item.uploadId}
                className={selected?.uploadId === item.uploadId ? "active" : ""}
                onClick={() => {
                  setSelectedId(item.uploadId);
                  onSelectionChange?.(item.uploadId);
                  resetPosition();
                }}
              >
                <span className="claim-image-thumb">
                  <AttachmentThumbnail item={item} />
                </span>
                <span className="claim-image-thumb-info">
                  <strong>{item.fileName}</strong>
                  <small>{formatFileSize(item.fileSize)}{(ocrResults[item.uploadId] ?? item.ocr) ? ` · ${ocrStatusLabels[(ocrResults[item.uploadId] ?? item.ocr)!.status]}` : ""}</small>
                </span>
              </button>
            );
          }) : <div className="claim-image-empty-list">暂无影像件<br />请在上方上传</div>}
        </div>

        <div className="claim-image-preview">
          {selected ? (
            <>
              <div
                className={`claim-image-preview-canvas ${dragging ? "dragging" : ""}`}
                title="滚轮缩放，按住鼠标拖动影像"
                onWheel={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  zoomBy(event.deltaY < 0 ? 0.25 : -0.25);
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0 || !selected || previewFailed) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  dragState.current = {
                    pointerId: event.pointerId,
                    startX: event.clientX,
                    startY: event.clientY,
                    originX: offset.x,
                    originY: offset.y,
                  };
                  setDragging(true);
                }}
                onPointerMove={(event) => {
                  const current = dragState.current;
                  if (!current || current.pointerId !== event.pointerId) return;
                  setOffset({
                    x: current.originX + event.clientX - current.startX,
                    y: current.originY + event.clientY - current.startY,
                  });
                }}
                onPointerUp={stopDragging}
                onPointerCancel={stopDragging}
              >
                {previewFailed || !previewUrl ? (
                  <div className="claim-image-preview-empty"><span>暂无可预览原件</span><small>历史测试数据仅保留了文件信息，可重新上传影像件。</small></div>
                ) : isPdf ? (
                  <div className="claim-image-transform-stage" style={{ width: `calc(${scale * 100}% - ${16 * scale}px)`, height: `calc(${scale * 100}% - ${16 * scale}px)`, transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg)` }}><iframe title={selected.fileName} src={previewUrl} onError={() => setPreviewFailed(true)} /></div>
                ) : (
                  <div className="claim-image-transform-stage" style={{ width: `calc(${scale * 100}% - ${16 * scale}px)`, height: `calc(${scale * 100}% - ${16 * scale}px)`, transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg)` }}><img src={previewUrl} alt={selected.fileName} draggable={false} decoding="sync" onError={() => setPreviewFailed(true)} /></div>
                )}
              </div>
              {ocrOpen ? <div className={`claim-image-ocr-panel ${selectedOcr?.status ?? "queued"}`}>
                <div className="claim-image-ocr-heading">
                  <strong>{selectedOcr ? ocrStatusLabels[selectedOcr.status] : "正在获取 OCR 状态"}</strong>
                  {selectedOcr?.status === "succeeded"
                    ? <small>{selectedOcr.documentType ?? "文档"} · {selectedOcr.pageCount ?? 1} 页 · {selectedOcr.durationMs ?? 0} ms</small>
                    : null}
                  {selectedOcr?.status === "failed"
                    ? <button type="button" className="secondary-button" onClick={() => void retryOcr()}>重新识别</button>
                    : null}
                </div>
                {selectedOcr?.status === "succeeded"
                  ? <pre>{selectedOcr.text || "未识别到文字"}</pre>
                  : selectedOcr?.status === "failed"
                    ? <p>{selectedOcr.lastError || "识别失败，请稍后重试。"}</p>
                    : <p>影像已进入后台队列，完成后会自动显示识别文字。</p>}
              </div> : null}
            </>
          ) : <div className="claim-image-preview-empty"><span>影像显示区域</span><small>上传或选择左侧影像件后在这里查看</small></div>}
        </div>
      </div>
    </aside>
  );
  return fullscreen ? createPortal(workspace, document.body) : workspace;
}
