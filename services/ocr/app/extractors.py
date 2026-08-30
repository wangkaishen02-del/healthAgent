from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class OcrLine:
    text: str
    score: float
    box: list[list[float]]
    page: int = 1


ID_CARD_KEYWORDS = ("公民身份号码", "姓名", "性别", "民族", "出生", "住址", "签发机关", "有效期限")
MEDICAL_KEYWORDS = (
    "医疗",
    "医院",
    "门诊",
    "住院",
    "收费票据",
    "发票",
    "医保",
    "患者",
    "病人",
    "金额",
)


def classify_document(lines: list[OcrLine]) -> tuple[str, float]:
    text = "\n".join(line.text for line in lines)
    id_hits = sum(keyword in text for keyword in ID_CARD_KEYWORDS)
    medical_hits = sum(keyword in text for keyword in MEDICAL_KEYWORDS)

    if re.search(r"\b\d{17}[\dXx]\b", text):
        id_hits += 2
    if re.search(r"(?:￥|¥|金额|合计).{0,8}\d+[.,]\d{2}", text):
        medical_hits += 2

    if id_hits >= 2 and id_hits > medical_hits:
        return "id_card", min(0.99, 0.55 + id_hits * 0.07)
    if medical_hits >= 2:
        return "medical_invoice", min(0.99, 0.5 + medical_hits * 0.06)
    return "unknown", 0.3


def _clean_value(value: str) -> str:
    return re.sub(r"^[：:|\s]+|[：:|\s]+$", "", value)


def _field(
    lines: list[OcrLine],
    patterns: tuple[str, ...],
    normalize: Callable[[str], str] | None = None,
) -> dict[str, Any] | None:
    for line in lines:
        for pattern in patterns:
            match = re.search(pattern, line.text, re.IGNORECASE)
            if not match:
                continue
            value = _clean_value(match.group(1))
            if normalize:
                value = normalize(value)
            if value:
                return {
                    "value": value,
                    "confidence": round(line.score, 4),
                    "sourceText": line.text,
                }
    return None


def _digits(value: str) -> str:
    return re.sub(r"[^\dXx]", "", value).upper()


def _date(value: str) -> str:
    parts = re.findall(r"\d+", value)
    if len(parts) >= 3:
        return f"{int(parts[0]):04d}-{int(parts[1]):02d}-{int(parts[2]):02d}"
    return value


def _money(value: str) -> str:
    normalized = value.replace(",", "").replace("，", "").replace("￥", "").replace("¥", "")
    match = re.search(r"-?\d+(?:\.\d{1,2})?", normalized)
    return f"{float(match.group(0)):.2f}" if match else ""


def _valid_china_id(number: str) -> bool:
    if not re.fullmatch(r"\d{17}[\dX]", number):
        return False
    weights = (7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2)
    checks = "10X98765432"
    return checks[sum(int(n) * weight for n, weight in zip(number[:17], weights)) % 11] == number[-1]


def extract_id_card(lines: list[OcrLine]) -> dict[str, Any]:
    id_number = _field(
        lines,
        (
            r"(?:公民身份号码|身份号码|身份证号)[：:\s]*(\d[\d\s]{15,20}[\dXx])",
            r"\b(\d{17}[\dXx])\b",
        ),
        _digits,
    )
    fields: dict[str, Any] = {
        "name": _field(lines, (r"姓名[：:\s]*([\u4e00-\u9fa5·]{2,20})",)),
        "gender": _field(lines, (r"性别[：:\s]*([男女])",)),
        "ethnicity": _field(lines, (r"民族[：:\s]*([\u4e00-\u9fa5]{1,10})",)),
        "birthDate": _field(
            lines,
            (r"出生[：:\s]*(\d{4}[年./-]\d{1,2}[月./-]\d{1,2}日?)",),
            _date,
        ),
        "idNumber": id_number,
        "address": _field(lines, (r"住址[：:\s]*(.+)",)),
        "issuingAuthority": _field(lines, (r"签发机关[：:\s]*(.+)",)),
        "validityPeriod": _field(lines, (r"有效期限[：:\s]*(.+)",)),
    }
    fields = {name: value for name, value in fields.items() if value}

    side = "front" if any(name in fields for name in ("name", "idNumber", "address")) else "back"
    warnings: list[str] = []
    if id_number and not _valid_china_id(id_number["value"]):
        warnings.append("身份证号码校验位未通过，请人工核对")
    if not id_number and side == "front":
        warnings.append("未识别到完整身份证号码")

    return {"side": side, "fields": fields, "warnings": warnings}


def _amount_field(lines: list[OcrLine], labels: tuple[str, ...]) -> dict[str, Any] | None:
    label_pattern = "|".join(re.escape(label) for label in labels)
    return _field(
        lines,
        (
            rf"(?:{label_pattern})[：:\s]*(?:人民币)?[￥¥]?\s*(-?[\d,，]+(?:\.\d{{1,2}})?)",
            rf"(?:{label_pattern}).{{0,12}}?(-?[\d,，]+\.\d{{2}})",
        ),
        _money,
    )


def extract_medical_invoice(lines: list[OcrLine]) -> dict[str, Any]:
    fields: dict[str, Any] = {
        "invoiceCode": _field(lines, (r"(?:发票代码|票据代码)[：:\s]*(\d{8,20})",), _digits),
        "invoiceNumber": _field(
            lines,
            (r"(?:发票号码|票据号码|票据号)[：:\s]*(\d{6,20})",),
            _digits,
        ),
        "checkCode": _field(lines, (r"校验码[：:\s]*(\d{6,30})",), _digits),
        "billDate": _field(
            lines,
            (r"(?:开票日期|票据日期|收费日期|日期)[：:\s]*(\d{4}[年./-]\d{1,2}[月./-]\d{1,2}日?)",),
            _date,
        ),
        "patientName": _field(
            lines,
            (r"(?:患者姓名|病人姓名|姓名)[：:\s]*([\u4e00-\u9fa5·]{2,20})",),
        ),
        "patientIdNumber": _field(
            lines,
            (r"(?:身份证号|社会保障号码)[：:\s]*(\d[\d\s]{15,20}[\dXx])",),
            _digits,
        ),
        "institution": _field(
            lines,
            (
                r"(?:医疗机构名称|收款单位|医院名称)[：:\s]*(.+)",
                r"^(.{2,30}(?:医院|卫生院|诊所|医疗中心))$",
            ),
        ),
        "totalAmount": _amount_field(lines, ("合计", "价税合计", "费用合计", "医疗费总额", "医疗总费用")),
        "insurancePayment": _amount_field(lines, ("医保统筹支付", "统筹基金支付", "医保支付")),
        "personalAccountPayment": _amount_field(lines, ("个人账户支付",)),
        "cashPayment": _amount_field(lines, ("个人现金支付", "现金支付", "个人支付")),
        "selfPayAmount": _amount_field(lines, ("自费金额", "个人自费", "自费")),
    }
    fields = {name: value for name, value in fields.items() if value}

    warnings: list[str] = []
    if "totalAmount" not in fields:
        warnings.append("未可靠识别票据总金额，请人工核对")
    if not any(key in fields for key in ("invoiceNumber", "invoiceCode", "institution")):
        warnings.append("票据关键标识不足，可能不是标准医疗票据")

    return {"fields": fields, "warnings": warnings}


def extract_structured(lines: list[OcrLine], document_type: str) -> dict[str, Any]:
    if document_type == "id_card":
        return extract_id_card(lines)
    if document_type == "medical_invoice":
        return extract_medical_invoice(lines)
    return {"fields": {}, "warnings": ["无法判断文档类型，仅返回原始 OCR 结果"]}
