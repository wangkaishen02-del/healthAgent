# 本地 OCR 服务

项目使用 RapidOCR + ONNX Runtime 在本机 Docker 中识别身份证和医疗票据。服务仅绑定
`127.0.0.1:18080`，图片不会发送给第三方。

## 接口

- `GET /health`：健康检查
- `POST /v1/ocr`：自动判断文档类型，表单字段 `file`，可选 `document_type`
- `POST /v1/ocr/id-card`：身份证图片
- `POST /v1/ocr/medical-invoice`：医疗票据图片
- `GET /docs`：可交互接口文档

支持 JPEG、PNG、WebP、BMP、TIFF 和 PDF，单文件最大 12MB，图片或单页 PDF
最大 3000 万像素，PDF 最多 10 页。

```bash
curl -F "file=@/绝对路径/身份证.jpg" \
  http://127.0.0.1:18080/v1/ocr/id-card
```

```bash
curl -F "file=@/绝对路径/医疗票据.jpg" \
  http://127.0.0.1:18080/v1/ocr/medical-invoice
```

返回内容包括逐行文字、识别置信度、文字坐标和结构化字段。结构化字段保留了来源文字与
字段置信度；业务系统仍应允许人工复核，不能只依赖 OCR 自动完成赔付判断。

## 业务系统队列

NestJS API 在影像上传成功后，以 `uploadId` 创建 `claim_attachment_ocr` 任务。任务和结果
均持久化到 PostgreSQL，API 重启后会恢复未完成或租约过期的任务。单个 API 进程顺序消费
任务，失败时采用退避重试，默认最多 3 次。

- `GET /api/claim-attachments/ocr?uploadId=...`：查询任务状态和识别结果
- `POST /api/claim-attachments/ocr/retry`：重新提交失败任务，请求体为 `{"uploadId":"..."}`

数据库保存 OCR 原文、逐行坐标与置信度、文档类型、结构化字段、耗时、页数、错误和尝试
次数，不保存第二份影像二进制。删除影像时会一并删除 OCR 任务和结果。

## 运维

```bash
docker compose up -d --build ocr
docker compose logs -f ocr
docker compose stop ocr
```

容器限制为 4 核、3GB 内存，使用原生 ARM64 镜像。首次构建需要下载基础镜像、Python
依赖和 OCR 模型，之后可离线运行。
