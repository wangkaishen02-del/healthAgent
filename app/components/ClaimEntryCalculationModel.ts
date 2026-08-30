import type { AppComboboxOption } from "./AppCombobox";
import type { AppSelectOption } from "./AppSelect";
import type { RegistrationSection } from "./ClaimRegistrationPage";
import { CLAIM_STATUS_LABELS } from "../../src/claims/state-machine";
import type { ClaimCase, ClaimPersonEvent } from "../../src/claims/types";

export type AcceptanceReviewTab = "acceptance_basic" | "acceptance_insured" | "acceptance_applicant" | "acceptance_payee" | "acceptance_remark";
export type EntryTab = "bill" | "event" | "disease" | AcceptanceReviewTab;
export type EntryWorkflowStatus = "editing" | "calculated";
export type BillAttachmentChangeDecision = "change" | "cancel" | "keep";

export type BillEntry = {
  id: string;
  claimCaseId: string;
  invoiceCode: string;
  invoiceNo: string;
  checkCode: string;
  billType: string;
  patientName: string;
  patientIdNo: string;
  visitNo: string;
  institution: string;
  department: string;
  billDate: string;
  admissionDate: string;
  dischargeDate: string;
  diagnosis: string;
  medicalInsuranceType: string;
  settlementNo: string;
  totalAmount: number;
  insuranceFundAmount: number;
  personalAccountAmount: number;
  cashAmount: number;
  selfPaidAmount: number;
  cashier: string;
  attachmentIds: string[];
  customValues: Record<string, string | number | boolean>;
  selectedBenefitIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type DiseaseEntry = {
  id: string;
  diseaseName: string;
  icdCode: string;
  diagnosisDate: string;
  hospital: string;
  note: string;
};

export type CaseEntryData = {
  bills: BillEntry[];
  events: ClaimPersonEvent[];
  diseases: DiseaseEntry[];
};

export type ProcessingCaseResult = {
  items: ClaimCase[];
  total: number;
  page: number;
  pageSize: number;
};

export type AutomationBenefit = {
  id: string;
  code: string;
  name: string;
  productId: string;
  planId?: string;
  productName: string;
};

export type CalculationDictionaryItem = {
  dictionaryType: string;
  itemCode: string;
  itemName: string;
};

export const billTypeOptions: AppSelectOption<string>[] = [
  { value: "1", label: "门诊" },
  { value: "2", label: "住院" },
  { value: "3", label: "门诊特殊病" },
  { value: "4", label: "药店购药" },
  { value: "9", label: "其他费用" },
];

export const medicalInsuranceTypeOptions: AppSelectOption<string>[] = [
  { value: "1", label: "城镇职工基本医疗保险" },
  { value: "2", label: "城乡居民基本医疗保险" },
  { value: "3", label: "新型农村合作医疗" },
  { value: "4", label: "商业健康保险" },
  { value: "5", label: "全自费" },
  { value: "9", label: "其他" },
];

export const eventTypeOptions: AppSelectOption<string>[] = [
  { value: "1", label: "疾病" },
  { value: "2", label: "意外" },
  { value: "9", label: "其他" },
];
export const eventFilterOptions: AppSelectOption<string>[] = [{ value: "all", label: "全部类型" }, ...eventTypeOptions];
export const eventAreaOptions: AppComboboxOption[] = [
  { value: "310115", label: "上海市 / 上海市 / 浦东新区", keywords: "上海 浦东 pudong" },
  { value: "310101", label: "上海市 / 上海市 / 黄浦区", keywords: "上海 黄浦 huangpu" },
  { value: "310104", label: "上海市 / 上海市 / 徐汇区", keywords: "上海 徐汇 xuhui" },
  { value: "110105", label: "北京市 / 北京市 / 朝阳区", keywords: "北京 朝阳 chaoyang" },
  { value: "110108", label: "北京市 / 北京市 / 海淀区", keywords: "北京 海淀 haidian" },
  { value: "440305", label: "广东省 / 深圳市 / 南山区", keywords: "广东 深圳 南山 shenzhen" },
  { value: "440106", label: "广东省 / 广州市 / 天河区", keywords: "广东 广州 天河 guangzhou" },
  { value: "330106", label: "浙江省 / 杭州市 / 西湖区", keywords: "浙江 杭州 西湖 hangzhou" },
  { value: "320102", label: "江苏省 / 南京市 / 玄武区", keywords: "江苏 南京 玄武 nanjing" },
  { value: "510107", label: "四川省 / 成都市 / 武侯区", keywords: "四川 成都 武侯 chengdu" },
];

export const acceptanceReviewSections: Array<{ tab: AcceptanceReviewTab; section: RegistrationSection; number: string; label: string }> = [
  { tab: "acceptance_basic", section: "basic", number: "01", label: "立案信息" },
  { tab: "acceptance_insured", section: "insured", number: "02", label: "被保人信息" },
  { tab: "acceptance_applicant", section: "applicant", number: "03", label: "申请人信息" },
  { tab: "acceptance_payee", section: "payee", number: "04", label: "领款人信息" },
  { tab: "acceptance_remark", section: "remark", number: "05", label: "案件备注" },
];

export const DEFAULT_CASE_PAGE_SIZE = 10;

export function adaptiveCasePageSize(viewportHeight: number) {
  return Math.max(5, Math.min(20, Math.floor((viewportHeight - 390) / 48)));
}

export function money(value: number) {
  return value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function emptyCalculationEventForm() {
  return {
    eventType: "1",
    occurredDate: "",
    administrativeArea: "",
    detailedAddress: "",
    hospitalName: "",
    diagnosis: "",
    description: "",
  };
}

export function emptyBillForm(patientName = "", patientIdNo = "") {
  return {
    invoiceCode: "",
    invoiceNo: "",
    checkCode: "",
    billType: "1",
    patientName,
    patientIdNo,
    visitNo: "",
    institution: "",
    department: "",
    billDate: "",
    admissionDate: "",
    dischargeDate: "",
    diagnosis: "",
    medicalInsuranceType: "1",
    settlementNo: "",
    totalAmount: "",
    insuranceFundAmount: "",
    personalAccountAmount: "",
    cashAmount: "",
    selfPaidAmount: "",
    cashier: "",
  };
}

export type ClaimEntryCalculationPageProps = {
  mode?: "processing" | "review" | "query";
  initialCase?: ClaimCase;
  onClose?: () => void;
};

export const detailStatusLabels: Record<ClaimCase["status"], string> = CLAIM_STATUS_LABELS;


