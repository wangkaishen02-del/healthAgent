"use client";

import { useEffect, useMemo, useState } from "react";
import type { ClaimUpload } from "../../src/claims/types";
import { apiUrl } from "../../src/api/client";

const attachmentCategoryLabels = {
  application: "理赔申请书",
  identity: "身份证明",
  medical: "病历资料",
  invoice: "发票费用清单",
  bank: "银行卡资料",
  other: "待 OCR 分类",
} as const;

type ClaimImageWorkspaceProps = {
  open: boolean;
  caseNo?: string;
  attachments: ClaimUpload[];
  busy?: boolean;
  disabled?: boolean;
  onClose: () => void;
  onUpload: (files: FileList | null) => void;
  onRemove?: (uploadId: string) => void;
};

function formatFileSize(value: number) {
  return value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export default function ClaimImageWorkspace({
  open,
  caseNo,
  attachments,
  busy = false,
  disabled = false,
  onClose,
  onUpload,
  onRemove,
}: ClaimImageWorkspaceProps) {
  const [selectedId, setSelectedId] = useState("");
  const [previewFailed, setPreviewFailed] = useState(false);
  const selected = useMemo(
    () => attachments.find((item) => item.uploadId === selectedId) ?? attachments[0] ?? null,
    [attachments, selectedId],
  );

  useEffect(() => {
    if (!attachments.length) setSelectedId("");
    else if (!attachments.some((item) => item.uploadId === selectedId)) setSelectedId(attachments[0].uploadId);
  }, [attachments, selectedId]);

  useEffect(() => {
    setPreviewFailed(false);
  }, [selected?.uploadId]);

  const previewUrl = selected ? apiUrl(`/api/claim-attachments?uploadId=${encodeURIComponent(selected.uploadId)}`) : "";
  const isPdf = selected?.mimeType === "application/pdf";

  return (
    <aside className="claim-image-workspace" aria-hidden={!open}>
      <div className="claim-image-workspace-header">
        <div>
          <div className="section-title">影像件</div>
          <small>{caseNo || "新建立案"} ｜ {attachments.length} 件</small>
        </div>
        <button type="button" className="secondary-button" onClick={onClose}>收起影像件</button>
      </div>

      <div className="claim-image-upload-bar">
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
      </div>

      <div className="claim-image-browser">
        <div className="claim-image-thumbnails">
          {attachments.length ? attachments.map((item) => {
            const itemUrl = apiUrl(`/api/claim-attachments?uploadId=${encodeURIComponent(item.uploadId)}`);
            return (
              <button
                type="button"
                key={item.uploadId}
                className={selected?.uploadId === item.uploadId ? "active" : ""}
                onClick={() => setSelectedId(item.uploadId)}
              >
                <span className="claim-image-thumb">
                  {item.mimeType === "application/pdf"
                    ? <b>PDF</b>
                    : <img src={itemUrl} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
                </span>
                <span className="claim-image-thumb-info">
                  <strong>{item.fileName}</strong>
                  <small>{attachmentCategoryLabels[item.category]} · {formatFileSize(item.fileSize)}</small>
                </span>
              </button>
            );
          }) : <div className="claim-image-empty-list">暂无影像件<br />请在上方选择分类并上传</div>}
        </div>

        <div className="claim-image-preview">
          {selected ? (
            <>
              <div className="claim-image-preview-title">
                <div><strong>{selected.fileName}</strong><small>{attachmentCategoryLabels[selected.category]}</small></div>
                {onRemove ? <button type="button" className="danger-link" disabled={disabled || busy} onClick={() => onRemove(selected.uploadId)}>删除</button> : null}
              </div>
              <div className="claim-image-preview-canvas">
                {previewFailed ? (
                  <div className="claim-image-preview-empty"><span>暂无可预览原件</span><small>历史测试数据仅保留了文件信息，可重新上传影像件。</small></div>
                ) : isPdf ? (
                  <iframe title={selected.fileName} src={previewUrl} onError={() => setPreviewFailed(true)} />
                ) : (
                  <img src={previewUrl} alt={selected.fileName} onError={() => setPreviewFailed(true)} />
                )}
              </div>
            </>
          ) : <div className="claim-image-preview-empty"><span>影像显示区域</span><small>上传或选择左侧影像件后在这里查看</small></div>}
        </div>
      </div>
    </aside>
  );
}
