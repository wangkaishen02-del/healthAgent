const MAX_ARRAY_ITEMS = 20;
const MAX_STRING_LENGTH = 2_000;

const OMITTED_KEYS = new Set([
  "base64",
  "bytes",
  "dataUrl",
  "fileContent",
  "imageData",
  "originalFile",
]);

const OCR_TEXT_KEYS = /^(?:fullText|ocrContent|ocrRawText|ocrText|rawText)$/i;

const NAME_KEYS = /^(?:insured|applicant|payee|patient|operator|claimant)?_?name$|(?:Name|姓名)$/i;
const ID_KEYS = /(?:idNo|idNumber|identityNo|证件号|身份证号)$/i;
const PHONE_KEYS = /(?:phone|mobile|手机号|联系电话)$/i;
const BANK_KEYS = /(?:bankAccountNo|cardNo|银行卡号|银行账号)$/i;
const MEDICAL_KEYS = /(?:diagnosis|diagnosisName|eventDescription|medicalSummary|诊断|病情描述)$/i;
const ADDRESS_KEYS = /(?:address|occurredLocation|hospitalAddress|地址|事故地点)$/i;

export function minimizeAssistantData(value: unknown, key = "", depth = 0): unknown {
  if (depth > 8) return "[已裁剪：嵌套层级过深]";
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (OCR_TEXT_KEYS.test(key)) return `[已裁剪 OCR 正文，共 ${[...value].length} 字符]`;
    if (value.length <= MAX_STRING_LENGTH) return value;
    return `${value.slice(0, MAX_STRING_LENGTH)}…[已裁剪 ${value.length - MAX_STRING_LENGTH} 字符]`;
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => minimizeAssistantData(item, key, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) items.push(`[已裁剪 ${value.length - MAX_ARRAY_ITEMS} 项]`);
    return items;
  }
  if (typeof value !== "object") return String(value);

  const result: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>)) {
    if (OMITTED_KEYS.has(entryKey)) {
      result[entryKey] = "[已移除文件内容]";
      continue;
    }
    result[entryKey] = minimizeAssistantData(entryValue, entryKey, depth + 1);
  }
  return result;
}

function maskId(value: string) {
  if (value.length <= 7) return "***";
  return `${value.slice(0, 3)}***********${value.slice(-4)}`;
}

function maskPhone(value: string) {
  return value.length >= 7 ? `${value.slice(0, 3)}****${value.slice(-4)}` : "***";
}

function maskBank(value: string) {
  return value.length >= 8 ? `${value.slice(0, 4)}********${value.slice(-4)}` : "***";
}

export function redactSensitiveText(content: string) {
  return content
    .replace(/\b\d{17}[0-9Xx]\b/g, (value) => maskId(value))
    .replace(/\b\d{15}\b/g, (value) => maskId(value))
    .replace(/\b1[3-9]\d{9}\b/g, (value) => maskPhone(value))
    .replace(/\b\d{16,19}\b/g, (value) => maskBank(value))
    .replace(/([\w.+-])[^\s@]*(@[^\s@]+\.[^\s@]+)/g, "$1***$2")
    .replace(/("(?:insured|applicant|payee|patient|operator|claimant)?Name"\s*:\s*")([^"]+)(")/gi, "$1***$3")
    .replace(/("(?:diagnosis|diagnosisName|eventDescription|medicalSummary|address|occurredLocation|hospitalAddress)"\s*:\s*")([^"]+)(")/gi, "$1***$3")
    .replace(/((?:被保人|申请人|领款人|患者|操作人)?姓名\s*[：:=]\s*)([\u4e00-\u9fa5·]{2,20})/g, "$1***");
}

type PiiKind = "NAME" | "ID" | "PHONE" | "BANK" | "EMAIL" | "MEDICAL" | "ADDRESS";

export class ExternalDataProtector {
  private readonly originalToToken = new Map<string, string>();
  private readonly tokenToOriginal = new Map<string, string>();
  private readonly counters: Record<PiiKind, number> = { NAME: 0, ID: 0, PHONE: 0, BANK: 0, EMAIL: 0, MEDICAL: 0, ADDRESS: 0 };

  private tokenFor(original: string, kind: PiiKind) {
    if (this.tokenToOriginal.has(original)) return original;
    const existing = this.originalToToken.get(original);
    if (existing) return existing;
    this.counters[kind] += 1;
    const token = `<PII_${kind}_${this.counters[kind]}>`;
    this.originalToToken.set(original, token);
    this.tokenToOriginal.set(token, original);
    return token;
  }

  protect(content: string) {
    let protectedContent = content
      .replace(/\b\d{17}[0-9Xx]\b/g, (value) => this.tokenFor(value, "ID"))
      .replace(/\b1[3-9]\d{9}\b/g, (value) => this.tokenFor(value, "PHONE"))
      .replace(/\b\d{16,19}\b/g, (value) => this.tokenFor(value, "BANK"))
      .replace(/\b\d{15}\b/g, (value) => this.tokenFor(value, "ID"))
      .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, (value) => this.tokenFor(value, "EMAIL"));

    protectedContent = protectedContent.replace(
      /("([^"\\]+)"\s*:\s*")([^"\\]+)(")/g,
      (match, prefix: string, key: string, value: string, suffix: string) => {
        const kind = NAME_KEYS.test(key)
          ? "NAME"
          : ID_KEYS.test(key)
            ? "ID"
            : PHONE_KEYS.test(key)
              ? "PHONE"
              : BANK_KEYS.test(key)
                ? "BANK"
                : MEDICAL_KEYS.test(key)
                  ? "MEDICAL"
                  : ADDRESS_KEYS.test(key)
                    ? "ADDRESS"
                    : null;
        return kind ? `${prefix}${this.tokenFor(value, kind)}${suffix}` : match;
      },
    );

    protectedContent = protectedContent.replace(
      /((?:查询|查找|检索|查一下|查|找|被保人|申请人|领款人|患者|姓名)(?:为|是|叫|：|:|\s)*)([\u4e00-\u9fa5·]{2,4})(?=的(?:保单|案件|信息|台账)|，|。|\s|$)/g,
      (_match, prefix: string, name: string) => `${prefix}${this.tokenFor(name, "NAME")}`,
    );
    protectedContent = protectedContent
      .replace(/((?:诊断|病情)(?:为|是|：|:)\s*)([^，。；\n]{2,80})/g, (_match, prefix: string, value: string) => `${prefix}${this.tokenFor(value, "MEDICAL")}`)
      .replace(/((?:地址|事故地点)(?:为|是|：|:)\s*)([^，。；\n]{2,120})/g, (_match, prefix: string, value: string) => `${prefix}${this.tokenFor(value, "ADDRESS")}`);
    return protectedContent;
  }

  restore(content: string) {
    return content.replace(/<PII_(?:NAME|ID|PHONE|BANK|EMAIL|MEDICAL|ADDRESS)_\d+>/g, (token) => this.tokenToOriginal.get(token) ?? token);
  }

  get replacementCount() {
    return this.tokenToOriginal.size;
  }
}
