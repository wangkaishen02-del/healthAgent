"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { RegisteredPageController } from "../../src/assistant/page-controller";
import type { ClaimAttachmentCategory, ClaimCase, ClaimCaseRemark, ClaimCaseStatus, ClaimEventInput, ClaimEventType, ClaimPartyRole, ClaimPartySnapshot, ClaimPaymentMethod, ClaimPersonEvent, ClaimRemarkStage, ClaimReportChannel, ClaimUpload } from "../../src/claims/types";
import { CLAIM_STATUS_LABELS, isClaimCaseEditable } from "../../src/claims/state-machine";
import type { PageResult, PolicyInsuredView, PolicyListItem } from "../../src/underwriting/types";
import { apiFetch } from "../../src/api/client";
import AppCombobox, { type AppComboboxOption } from "./AppCombobox";
import AppDatePicker from "./AppDatePicker";
import AppSelect, { type AppSelectOption } from "./AppSelect";
import ClaimImageWorkspace from "./ClaimImageWorkspace";

type PartyForm = ClaimPartySnapshot;
type PayeeSource = "insured" | "applicant" | "other";
type ClaimAction = "submit" | "cancel";
export type RegistrationSection = "basic" | "insured" | "applicant" | "payee" | "event" | "remark" | "attachments";
type ValidationErrors = Record<string, string>;
type ClaimRegistrationPageProps = {
  embeddedCase?: ClaimCase;
  readOnly?: boolean;
  embeddedSection?: RegistrationSection;
  compactEmbedded?: boolean;
  remarkStage?: ClaimRemarkStage;
  allowRemarkAdd?: boolean;
  onCaseUpdated?: (item: ClaimCase) => void;
};

const reportChannelOptions: AppSelectOption<ClaimReportChannel>[] = [{ value: "online", label: "线上报案" }, { value: "phone", label: "电话报案" }, { value: "counter", label: "柜面报案" }, { value: "other", label: "其他" }];
const genderOptions: AppSelectOption<PartyForm["gender"]>[] = [{ value: "unknown", label: "未知" }, { value: "male", label: "男" }, { value: "female", label: "女" }];
const idTypeOptions: AppSelectOption<PartyForm["idType"]>[] = [{ value: "id_card", label: "身份证" }, { value: "passport", label: "护照" }, { value: "other", label: "其他" }];
const eventTypeOptions: AppSelectOption<ClaimEventType>[] = [{ value: "1", label: "疾病" }, { value: "2", label: "意外" }, { value: "9", label: "其他" }];
const eventFilterOptions: AppSelectOption<"all" | ClaimEventType>[] = [{ value: "all", label: "全部类型" }, ...eventTypeOptions];
const payeeSourceOptions: AppSelectOption<PayeeSource>[] = [{ value: "insured", label: "同被保人" }, { value: "applicant", label: "同申请人" }, { value: "other", label: "另行填写" }];
const paymentMethodOptions: AppSelectOption<ClaimPaymentMethod>[] = [{ value: "pending", label: "待确定" }, { value: "bank_transfer", label: "银行转账" }, { value: "cash", label: "现金领取" }, { value: "other", label: "其他方式" }];
const areaOptions: AppComboboxOption[] = [
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
const claimStatusLabels: Record<ClaimCaseStatus, string> = CLAIM_STATUS_LABELS;
const claimRemarkStageLabels: Record<ClaimRemarkStage, string> = { acceptance: "受理", calculation: "理算", review: "审核" };
const claimTransitionActionLabels = { create: "创建案件", submit: "受理提交", calculate: "完成理算", rollback: "流程回退", rollback_calculation: "理算回退", submit_review: "提交审核", complete: "审核结案", cancel: "案件撤件", legacy_import: "历史状态导入" } as const;
function mutationHeaders(operationId?: string) { return { "Content-Type": "application/json", "Idempotency-Key": operationId ?? crypto.randomUUID() }; }

function Required() { return <span className="required-mark" aria-label="必填">*</span>; }
function FieldError({ message }: { message?: string }) { return message ? <small className="field-error">{message}</small> : null; }
function emptyEvent(): ClaimEventInput { return { eventType: "1", occurredDate: "", administrativeArea: "", detailedAddress: "", hospitalName: "", diagnosis: "", description: "" }; }
function eventDraftFrom(item: ClaimPersonEvent): ClaimEventInput { return { eventType: item.eventType, occurredDate: item.occurredDate, administrativeArea: item.administrativeArea ?? "", detailedAddress: item.detailedAddress ?? "", hospitalName: item.hospitalName ?? "", diagnosis: item.diagnosis ?? "", description: item.description }; }
function emptyParty(role: ClaimPartyRole): PartyForm { return { role, name: "", gender: "unknown", birthDate: "", idType: "id_card", idNo: "", idValidFrom: "", idValidTo: "", idLongTerm: false, address: "", phone: "", relationToInsured: role === "insured" ? "本人" : "", bankName: "", bankAccountName: "", bankAccountNo: "", paymentMethod: role === "payee" ? "pending" : undefined }; }
function partyFromInsured(item: PolicyInsuredView): PartyForm { const person = item.insuredPerson; return { ...emptyParty("insured"), name: person.name, gender: person.gender ?? "unknown", birthDate: person.birthDate ?? "", idType: person.idType ?? "id_card", idNo: person.idNo ?? "", phone: person.phone ?? "" }; }
function copyParty(source: PartyForm, role: ClaimPartyRole, relationToInsured: string) { return { ...source, role, relationToInsured, idValidTo: source.idLongTerm ? "" : source.idValidTo, paymentMethod: role === "payee" ? source.paymentMethod ?? "pending" : undefined, bankAccountName: role === "payee" ? source.bankAccountName || source.name : source.bankAccountName }; }
function resolvePartyDateInput(value: string, currentValue: string) {
  const normalized = value.trim();
  if (!normalized) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  const yearMatch = normalized.match(/^(\d{2}|\d{4})年?$/);
  if (!yearMatch || !/^\d{4}-\d{2}-\d{2}$/.test(currentValue)) return null;
  const rawYear = Number(yearMatch[1]);
  const year = yearMatch[1].length === 4 ? rawYear : rawYear <= 49 ? 2000 + rawYear : 1900 + rawYear;
  return `${String(year).padStart(4, "0")}${currentValue.slice(4)}`;
}

function PartySection({ title, prefix, value, onChange, errors, identityDisabled = false, formDisabled = false, showBank = false, extra }: { title: string; prefix: string; value: PartyForm; onChange: (value: PartyForm) => void; errors: ValidationErrors; identityDisabled?: boolean; formDisabled?: boolean; showBank?: boolean; extra?: React.ReactNode }) {
  function update<K extends keyof PartyForm>(field: K, next: PartyForm[K]) {
    if (field === "idLongTerm" && next === true) { onChange({ ...value, idLongTerm: true, idValidTo: "" }); return; }
    if (field === "idValidTo" && typeof next === "string" && next) { onChange({ ...value, idValidTo: next, idLongTerm: false }); return; }
    onChange({ ...value, [field]: next });
  }
  const locked = identityDisabled || formDisabled;
  const bankRequired = showBank && value.paymentMethod === "bank_transfer";
  return <section className="panel claim-form-panel">
    <div className="panel-title-row"><div className="section-title">{title}</div>{extra}</div>
    <div className="claim-form-grid">
      <label><span>姓名 <Required /></span><input className={errors[`${prefix}Name`] ? "invalid" : ""} disabled={locked} value={value.name} onChange={(event) => update("name", event.target.value)} /><FieldError message={errors[`${prefix}Name`]} /></label>
      <label><span>与被保人关系</span><input disabled={locked || value.role === "insured"} value={value.relationToInsured ?? ""} onChange={(event) => update("relationToInsured", event.target.value)} /></label>
      <label><span>性别</span><AppSelect ariaLabel={`${title}性别`} disabled={locked} value={value.gender} options={genderOptions} onChange={(next) => update("gender", next)} /></label>
      <label><span>出生日期</span><AppDatePicker ariaLabel={`${title}出生日期`} disabled={locked} value={value.birthDate} onChange={(next) => update("birthDate", next)} /></label>
      <label><span>证件类型</span><AppSelect ariaLabel={`${title}证件类型`} disabled={locked} value={value.idType} options={idTypeOptions} onChange={(next) => update("idType", next)} /></label>
      <label><span>证件号码 <Required /></span><input className={errors[`${prefix}IdNo`] ? "invalid" : ""} disabled={locked} value={value.idNo} onChange={(event) => update("idNo", event.target.value.toUpperCase())} /><FieldError message={errors[`${prefix}IdNo`]} /></label>
      <label><span>证件有效期起</span><AppDatePicker ariaLabel={`${title}证件有效期起`} disabled={locked} value={value.idValidFrom} onChange={(next) => update("idValidFrom", next)} /></label>
      <label><span>证件有效期止</span><AppDatePicker ariaLabel={`${title}证件有效期止`} disabled={locked || value.idLongTerm} value={value.idValidTo} onChange={(next) => update("idValidTo", next)} /></label>
      <label className="claim-check-field"><input type="checkbox" disabled={locked} checked={value.idLongTerm} onChange={(event) => update("idLongTerm", event.target.checked)} /><span>证件长期有效</span></label>
      <label><span>联系电话 <Required /></span><input className={errors[`${prefix}Phone`] ? "invalid" : ""} disabled={locked} value={value.phone} onChange={(event) => update("phone", event.target.value)} /><FieldError message={errors[`${prefix}Phone`]} /></label>
      <label className="claim-wide-field"><span>联系地址</span><input disabled={locked} value={value.address} onChange={(event) => update("address", event.target.value)} /></label>
      {showBank ? <>
        <label><span>领款方式 <Required /></span><AppSelect ariaLabel="领款方式" disabled={formDisabled} value={value.paymentMethod ?? ""} options={paymentMethodOptions} onChange={(next) => update("paymentMethod", next)} /><FieldError message={errors.payeePaymentMethod} /></label>
        {value.paymentMethod === "bank_transfer" ? <>
          <label><span>开户银行 {bankRequired ? <Required /> : null}</span><input className={errors.payeeBankName ? "invalid" : ""} disabled={formDisabled} value={value.bankName ?? ""} onChange={(event) => update("bankName", event.target.value)} /><FieldError message={errors.payeeBankName} /></label>
          <label><span>账户名称 {bankRequired ? <Required /> : null}</span><input className={errors.payeeBankAccountName ? "invalid" : ""} disabled={formDisabled} value={value.bankAccountName ?? ""} onChange={(event) => update("bankAccountName", event.target.value)} /><FieldError message={errors.payeeBankAccountName} /></label>
          <label className="claim-wide-field"><span>银行账号 {bankRequired ? <Required /> : null}</span><input className={errors.payeeBankAccountNo ? "invalid" : ""} disabled={formDisabled} value={value.bankAccountNo ?? ""} onChange={(event) => update("bankAccountNo", event.target.value)} /><FieldError message={errors.payeeBankAccountNo} /></label>
        </> : null}
      </> : null}
    </div>
  </section>;
}

const ClaimRegistrationPage = forwardRef<RegisteredPageController, ClaimRegistrationPageProps>(function ClaimRegistrationPage({ embeddedCase, readOnly = false, embeddedSection, compactEmbedded = false, remarkStage = "acceptance", allowRemarkAdd = !readOnly, onCaseUpdated }, assistantRef) {
  const [cases, setCases] = useState<ClaimCase[]>([]);
  const [caseListExpanded, setCaseListExpanded] = useState(true);
  const [activeSection, setActiveSection] = useState<RegistrationSection>("basic");
  const [policyCandidates, setPolicyCandidates] = useState<PolicyListItem[]>([]);
  const [editingCaseId, setEditingCaseId] = useState(""); const [editingStatus, setEditingStatus] = useState<ClaimCaseStatus | null>(null);
  const [policyNo, setPolicyNo] = useState(""); const [insuredIdNo, setInsuredIdNo] = useState(""); const [policy, setPolicy] = useState<PolicyListItem | null>(null); const [selectedPolicyInsuredId, setSelectedPolicyInsuredId] = useState(""); const [insuredPersonId, setInsuredPersonId] = useState("");
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().slice(0, 10)); const [reportChannel, setReportChannel] = useState<ClaimReportChannel>("online"); const [remark, setRemark] = useState("");
  const [caseRemarks, setCaseRemarks] = useState<ClaimCaseRemark[]>([]); const [newRemark, setNewRemark] = useState(""); const [remarkBusy, setRemarkBusy] = useState(false);
  const [insured, setInsured] = useState<PartyForm>(() => emptyParty("insured")); const [applicant, setApplicant] = useState<PartyForm>(() => emptyParty("applicant")); const [payee, setPayee] = useState<PartyForm>(() => emptyParty("payee"));
  const [applicantSameAsInsured, setApplicantSameAsInsured] = useState(true); const [payeeSource, setPayeeSource] = useState<PayeeSource>("insured");
  const [personEvents, setPersonEvents] = useState<ClaimPersonEvent[]>([]); const [selectedEventId, setSelectedEventId] = useState(""); const [eventKeyword, setEventKeyword] = useState(""); const [eventTypeFilter, setEventTypeFilter] = useState<"all" | ClaimEventType>("all"); const [eventDateFilter, setEventDateFilter] = useState(""); const [eventEditorOpen, setEventEditorOpen] = useState(false); const [editingEventId, setEditingEventId] = useState(""); const [eventDraft, setEventDraft] = useState<ClaimEventInput>(() => emptyEvent());
  const [attachmentCategory, setAttachmentCategory] = useState<ClaimAttachmentCategory>("other"); const [attachments, setAttachments] = useState<ClaimUpload[]>([]);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [cancelPromptOpen, setCancelPromptOpen] = useState(false);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [successNotice, setSuccessNotice] = useState(""); const [errors, setErrors] = useState<ValidationErrors>({});
  const stateRef = useRef({ cases, editingCaseId, editingStatus, policyNo, insuredIdNo, policy, selectedPolicyInsuredId, insuredPersonId, reportDate, reportChannel, remark, insured, applicant, payee, applicantSameAsInsured, payeeSource, personEvents, selectedEventId, eventKeyword, eventTypeFilter, eventDateFilter, editingEventId, eventDraft, attachmentCategory, attachments });
  const openCaseRequestRef = useRef(0);
  const imageStageRef = useRef<HTMLDivElement | null>(null);
  const caseListPanelRef = useRef<HTMLElement | null>(null);
  stateRef.current = { cases, editingCaseId, editingStatus, policyNo, insuredIdNo, policy, selectedPolicyInsuredId, insuredPersonId, reportDate, reportChannel, remark, insured, applicant, payee, applicantSameAsInsured, payeeSource, personEvents, selectedEventId, eventKeyword, eventTypeFilter, eventDateFilter, editingEventId, eventDraft, attachmentCategory, attachments };
  const formDisabled = readOnly || (editingStatus !== null && (!isClaimCaseEditable(editingStatus, "acceptance") || (!embeddedCase && editingStatus !== "registered")));
  const displayedSection = embeddedSection ?? activeSection;
  const filteredEvents = useMemo(() => personEvents.filter((item) => eventTypeFilter === "all" || item.eventType === eventTypeFilter).filter((item) => !eventDateFilter || item.occurredDate === eventDateFilter).filter((item) => { const key = eventKeyword.trim().toLowerCase(); return !key || [item.eventNo, item.administrativeArea, item.detailedAddress, item.hospitalName, item.diagnosis, item.description].some((value) => value?.toLowerCase().includes(key)); }), [personEvents, eventKeyword, eventTypeFilter, eventDateFilter]);

  async function loadCases() { const response = await apiFetch("/api/claim-registrations?status=registered&page=1&pageSize=100", { cache: "no-store" }); const data = await response.json() as { items: ClaimCase[] }; setCases(data.items); stateRef.current = { ...stateRef.current, cases: data.items }; return data.items; }
  async function loadEvents(personId: string) { if (!personId) { setPersonEvents([]); return []; } const response = await apiFetch(`/api/claim-events?insuredPersonId=${encodeURIComponent(personId)}`, { cache: "no-store" }); const data = await response.json() as { items: ClaimPersonEvent[] }; setPersonEvents(data.items); stateRef.current = { ...stateRef.current, personEvents: data.items }; return data.items; }
  useEffect(() => { if (!embeddedCase) void loadCases(); }, [embeddedCase?.id]);
  useEffect(() => { if (embeddedCase) void openCase(embeddedCase); }, [embeddedCase?.id]);
  useEffect(() => { if (!successNotice) return; const timer = window.setTimeout(() => setSuccessNotice(""), 5000); return () => window.clearTimeout(timer); }, [successNotice]);
  useEffect(() => {
    const stage = imageStageRef.current;
    const panel = caseListPanelRef.current;
    if (!stage || !panel || compactEmbedded) return;
    const updateDrawerTop = () => stage.style.setProperty("--claim-image-registration-top", `${panel.offsetHeight + 14}px`);
    updateDrawerTop();
    const observer = new ResizeObserver(updateDrawerTop);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [caseListExpanded, compactEmbedded]);

  function resetForm(actionId: "reset" | "new_case" = "reset") { openCaseRequestRef.current += 1; const today = new Date().toISOString().slice(0, 10); const insuredEmpty = emptyParty("insured"), applicantEmpty = emptyParty("applicant"), payeeEmpty = emptyParty("payee"); setEditingCaseId(""); setEditingStatus(null); setPolicyNo(""); setInsuredIdNo(""); setPolicy(null); setPolicyCandidates([]); setSelectedPolicyInsuredId(""); setInsuredPersonId(""); setReportDate(today); setReportChannel("online"); setRemark(""); setCaseRemarks([]); setNewRemark(""); setInsured(insuredEmpty); setApplicant(applicantEmpty); setPayee(payeeEmpty); setApplicantSameAsInsured(true); setPayeeSource("insured"); setPersonEvents([]); setSelectedEventId(""); setEventKeyword(""); setEventTypeFilter("all"); setEventDateFilter(""); setEventEditorOpen(false); setEditingEventId(""); setEventDraft(emptyEvent()); setAttachmentCategory("other"); setAttachments([]); setCancelPromptOpen(false); setMessage(""); setSuccessNotice(""); setErrors({}); setBusy(false); setActiveSection("basic"); stateRef.current = { ...stateRef.current, editingCaseId: "", editingStatus: null, policyNo: "", insuredIdNo: "", policy: null, selectedPolicyInsuredId: "", insuredPersonId: "", reportDate: today, reportChannel: "online", remark: "", insured: insuredEmpty, applicant: applicantEmpty, payee: payeeEmpty, applicantSameAsInsured: true, payeeSource: "insured", personEvents: [], selectedEventId: "", eventKeyword: "", eventTypeFilter: "all", eventDateFilter: "", editingEventId: "", eventDraft: emptyEvent(), attachmentCategory: "other", attachments: [] }; return { type: "page_action", pageId: "claim_registration", actionId }; }

  async function selectPolicyInsured(matchedPolicy: PolicyListItem) {
    const normalizedIdNo = stateRef.current.insuredIdNo.trim().toUpperCase();
    setBusy(true);
    const insuredResponse = await apiFetch(`/api/policies/${encodeURIComponent(matchedPolicy.id)}/insureds?page=1&pageSize=100`, { cache: "no-store" });
    const insuredResult = await insuredResponse.json() as PageResult<PolicyInsuredView>;
    const matchedInsured = insuredResult.items.find((item) => (item.insuredPerson.idNo ?? "").toUpperCase() === normalizedIdNo);
    if (!matchedInsured) {
      setBusy(false);
      setMessage("该证件号与所选保单的承保关系已发生变化，请重新查询。");
      return { type: "operation_error", reason: "policy_insured_not_found" };
    }
    const nextInsured = partyFromInsured(matchedInsured);
    const nextApplicant = copyParty(nextInsured, "applicant", "本人");
    const nextPayee = copyParty(nextInsured, "payee", "本人");
    setPolicyNo(matchedPolicy.policyNo);
    setPolicy(matchedPolicy);
    setSelectedPolicyInsuredId(matchedInsured.id);
    setInsuredPersonId(matchedInsured.insuredPerson.id);
    setInsured(nextInsured);
    setApplicant(nextApplicant);
    setPayee(nextPayee);
    setApplicantSameAsInsured(true);
    setPayeeSource("insured");
    setSelectedEventId("");
    setErrors({});
    await loadEvents(matchedInsured.insuredPerson.id);
    setBusy(false);
    setMessage(`已选择保单 ${matchedPolicy.policyNo}，并锁定被保人 ${nextInsured.name}。`);
    stateRef.current = { ...stateRef.current, policyNo: matchedPolicy.policyNo, insuredIdNo: normalizedIdNo, policy: matchedPolicy, selectedPolicyInsuredId: matchedInsured.id, insuredPersonId: matchedInsured.insuredPerson.id, insured: nextInsured, applicant: nextApplicant, payee: nextPayee, applicantSameAsInsured: true, payeeSource: "insured", selectedEventId: "" };
    return { type: "insured_locked", policyId: matchedPolicy.id, policyNo: matchedPolicy.policyNo, policyInsuredId: matchedInsured.id, insuredPersonId: matchedInsured.insuredPerson.id };
  }

  async function lockPolicyInsured() {
    const normalizedIdNo = stateRef.current.insuredIdNo.trim().toUpperCase();
    if (!normalizedIdNo) {
      setErrors({ insuredIdNo: "请输入被保人证件号" });
      setMessage("请输入证件号后查询关联保单。");
      return { type: "operation_error", reason: "insured_id_required" };
    }
    setBusy(true);
    setMessage("");
    setPolicy(null);
    setPolicyNo("");
    setPolicyCandidates([]);
    const policyResponse = await apiFetch(`/api/policies?insuredIdNo=${encodeURIComponent(normalizedIdNo)}&pageSize=100`, { cache: "no-store" });
    const policyResult = await policyResponse.json() as PageResult<PolicyListItem>;
    if (!policyResult.items.length) {
      setBusy(false);
      setMessage("未找到该证件号绑定的保单。");
      return { type: "operation_error", reason: "policy_insured_not_found" };
    }
    setPolicyCandidates(policyResult.items);
    setErrors({});
    stateRef.current = { ...stateRef.current, insuredIdNo: normalizedIdNo, policyNo: "", policy: null };
    if (policyResult.items.length === 1) return selectPolicyInsured(policyResult.items[0]);
    setBusy(false);
    setMessage(`查询到 ${policyResult.items.length} 张关联保单，请从列表中选择本次理赔保单。`);
    return { type: "selection_required", reason: "multiple_policies", policies: policyResult.items.map((item) => ({ itemId: item.id, policyNo: item.policyNo, policyName: item.policyName })) };
  }

  async function openCase(item: ClaimCase) {
    setActiveSection("basic");
    setCaseListExpanded(false);
    setPolicyCandidates([]);
    const requestId = ++openCaseRequestRef.current;
    const insuredParty = item.parties.find((party) => party.role === "insured") ?? emptyParty("insured");
    const applicantParty = item.parties.find((party) => party.role === "applicant") ?? emptyParty("applicant");
    const savedPayee = item.parties.find((party) => party.role === "payee");
    const payeeParty = { ...(savedPayee ?? emptyParty("payee")), paymentMethod: savedPayee?.paymentMethod ?? "bank_transfer" };
    const initialEvents = [item.event];

    // 先同步切换到已选案件状态，避免等待详情请求期间按钮仍显示“保存立案”。
    setEditingCaseId(item.id); setEditingStatus(item.status); setPolicyNo(item.policyNo); setInsuredIdNo(insuredParty.idNo); setPolicy(null); setSelectedPolicyInsuredId(item.policyInsuredId); setInsuredPersonId(item.insuredPersonId); setReportDate(item.reportDate); setReportChannel(item.reportChannel); setRemark(item.remark ?? ""); setCaseRemarks(item.remarks ?? []); setNewRemark(""); setInsured(insuredParty); setApplicant(applicantParty); setPayee(payeeParty); setApplicantSameAsInsured(false); setPayeeSource("other"); setPersonEvents(initialEvents); setSelectedEventId(item.eventId); setAttachments(item.attachments); setErrors({}); setSuccessNotice(""); setMessage(`正在加载案件 ${item.caseNo}…`); setBusy(true);
    stateRef.current = { ...stateRef.current, editingCaseId: item.id, editingStatus: item.status, policyNo: item.policyNo, insuredIdNo: insuredParty.idNo, policy: null, selectedPolicyInsuredId: item.policyInsuredId, insuredPersonId: item.insuredPersonId, reportDate: item.reportDate, reportChannel: item.reportChannel, remark: item.remark ?? "", insured: insuredParty, applicant: applicantParty, payee: payeeParty, applicantSameAsInsured: false, payeeSource: "other", personEvents: initialEvents, selectedEventId: item.eventId, attachments: item.attachments };

    try {
      const [policyResult, events] = await Promise.all([
        apiFetch(`/api/policies?policyNo=${encodeURIComponent(item.policyNo)}&pageSize=20`, { cache: "no-store" }).then((response) => response.json() as Promise<PageResult<PolicyListItem>>),
        apiFetch(`/api/claim-events?insuredPersonId=${encodeURIComponent(item.insuredPersonId)}`, { cache: "no-store" }).then((response) => response.json() as Promise<{ items: ClaimPersonEvent[] }>).then((result) => result.items),
      ]);
      if (requestId !== openCaseRequestRef.current) return { type: "operation_cancelled", reason: "newer_case_selected" };
      const matchedPolicy = policyResult.items.find((candidate) => candidate.id === item.policyId) ?? null;
      const nextEvents = events.some((event) => event.id === item.eventId) ? events : [item.event, ...events];
      setPolicy(matchedPolicy); setPersonEvents(nextEvents); setMessage(`正在${item.status === "registered" ? "编辑" : "查看"}案件 ${item.caseNo}`);
      stateRef.current = { ...stateRef.current, policy: matchedPolicy, personEvents: nextEvents };
    } catch {
      if (requestId === openCaseRequestRef.current) setMessage(`案件 ${item.caseNo} 的关联信息加载失败，请重新选择。`);
      return { type: "operation_error", reason: "claim_case_detail_load_failed", caseNo: item.caseNo };
    } finally {
      if (requestId === openCaseRequestRef.current) setBusy(false);
    }
    return { type: "detail_view", caseNo: item.caseNo, status: item.status };
  }

  function validateCase(current: typeof stateRef.current) { const next: ValidationErrors = {}; if (!current.policy) next.policyNo = "请先锁定有效保单"; if (!current.insuredIdNo.trim()) next.insuredIdNo = "请输入被保人证件号"; if (!current.reportDate) next.reportDate = "请选择报案日期"; for (const [prefix, party] of [["insuredParty", current.insured], ["applicant", current.applicant], ["payee", current.payee]] as const) { if (!party.name.trim()) next[`${prefix}Name`] = "请填写姓名"; if (!party.idNo.trim()) next[`${prefix}IdNo`] = "请填写证件号码"; if (!party.phone.trim()) next[`${prefix}Phone`] = "请填写联系电话"; } if (!current.payee.paymentMethod) next.payeePaymentMethod = "请选择领款方式"; if (current.payee.paymentMethod === "bank_transfer") { if (!current.payee.bankName?.trim()) next.payeeBankName = "请填写开户银行"; if (!current.payee.bankAccountName?.trim()) next.payeeBankAccountName = "请填写账户名称"; if (!current.payee.bankAccountNo?.trim()) next.payeeBankAccountNo = "请填写银行账号"; } if (!current.selectedEventId) next.selectedEventId = "请选择已有事件，或新增事件后自动关联"; setErrors(next); if (Object.keys(next).length) { if (next.policyNo || next.insuredIdNo || next.reportDate) setActiveSection("basic"); else if (Object.keys(next).some((key) => key.startsWith("insuredParty"))) setActiveSection("insured"); else if (Object.keys(next).some((key) => key.startsWith("applicant"))) setActiveSection("applicant"); else if (Object.keys(next).some((key) => key.startsWith("payee"))) setActiveSection("payee"); else if (next.selectedEventId) setActiveSection("event"); setMessage("保存失败，请补充页面中提示的必填项。"); return false; } return true; }
  function buildPayload(current = stateRef.current) { return { policyId: current.policy?.id, policyInsuredId: current.selectedPolicyInsuredId, reportDate: current.reportDate, reportChannel: current.reportChannel, remark: current.remark, parties: [current.insured, current.applicant, current.payee], eventId: current.selectedEventId, attachments: current.attachments }; }
  async function addCaseRemark() {
    const content = newRemark.trim();
    if (!editingCaseId || !content || !allowRemarkAdd) return;
    setRemarkBusy(true);
    const response = await apiFetch("/api/claim-remarks", { method: "POST", headers: mutationHeaders(), body: JSON.stringify({ claimCaseId: editingCaseId, stage: remarkStage, content }) });
    const result = await response.json() as ClaimCaseRemark & { message?: string };
    setRemarkBusy(false);
    if (!response.ok) { setMessage("备注新增失败，请稍后重试。"); return; }
    const nextRemarks = [result, ...caseRemarks];
    setCaseRemarks(nextRemarks); setNewRemark(""); setMessage(`已新增一条${claimRemarkStageLabels[remarkStage]}备注。`);
    setCases((items) => items.map((item) => item.id === editingCaseId ? { ...item, remarks: nextRemarks } : item));
    if (embeddedCase?.id === editingCaseId) onCaseUpdated?.({ ...embeddedCase, remarks: nextRemarks });
  }
  async function saveCase(useRef = false, operationId?: string) { const current = useRef ? stateRef.current : { ...stateRef.current, editingCaseId, editingStatus, policy, selectedPolicyInsuredId, insuredPersonId, reportDate, reportChannel, remark, insured, applicant, payee, personEvents, selectedEventId, eventDraft, attachments }; if (current.editingStatus && (!isClaimCaseEditable(current.editingStatus, "acceptance") || (!embeddedCase && current.editingStatus !== "registered"))) return { type: "operation_error", reason: "claim_case_not_editable" }; if (!validateCase(current)) return { type: "operation_error", reason: "required_fields_incomplete", fields: Object.keys(errors) }; const isEditing = Boolean(current.editingCaseId); setBusy(true); const response = await apiFetch("/api/claim-registrations", { method: isEditing ? "PUT" : "POST", headers: mutationHeaders(operationId), body: JSON.stringify({ ...(isEditing ? { id: current.editingCaseId } : {}), ...buildPayload(current) }) }); const result = await response.json() as ClaimCase & { message?: string }; setBusy(false); if (!response.ok) { setMessage("保存失败，请检查填写内容。"); return { type: "operation_error", reason: result.message ?? "claim_save_failed" }; } if (!embeddedCase) await loadCases(); if (isEditing) { setEditingCaseId(result.id); setEditingStatus(result.status); stateRef.current = { ...stateRef.current, editingCaseId: result.id, editingStatus: result.status }; setMessage(`案件 ${result.caseNo} 的修改已保存。`); setSuccessNotice(`案件 ${result.caseNo} 修改保存成功`); onCaseUpdated?.(result); } else { resetForm(); setSuccessNotice(`立案成功，案件号：${result.caseNo}`); } return { type: "mutation_result", operation: isEditing ? "update" : "create", success: true, caseId: result.id, caseNo: result.caseNo, formReset: !isEditing }; }
  async function changeStatus(action: ClaimAction, operationId?: string) {
    const id = stateRef.current.editingCaseId;
    if (!id) {
      setMessage(action === "cancel" ? "请先双击选择需要撤件的案件。" : "请先保存立案，再提交案件。");
      return { type: "operation_error", reason: "claim_case_required" };
    }
    if (action === "cancel") setCancelPromptOpen(false);
    setBusy(true);
    const response = await apiFetch("/api/claim-registrations", { method: "PATCH", headers: mutationHeaders(operationId), body: JSON.stringify({ id, action }) });
    const result = await response.json() as ClaimCase & { message?: string };
    setBusy(false);
    if (!response.ok) {
      setMessage("案件状态已变化，无法重复操作。");
      return { type: "operation_error", reason: result.message ?? "claim_status_failed" };
    }
    await loadCases();
    window.dispatchEvent(new CustomEvent("claim-case-status-changed"));
    resetForm();
    setSuccessNotice(action === "cancel" ? `案件 ${result.caseNo} 已撤件` : `案件 ${result.caseNo} 已转入录入`);
    return { type: "mutation_result", operation: action, success: true, caseNo: result.caseNo, status: result.status };
  }

  function validateEventDraft(draft: ClaimEventInput) { const next = { ...errors }; delete next.eventOccurredDate; delete next.eventAdministrativeArea; delete next.eventDescription; if (!draft.occurredDate) next.eventOccurredDate = "请选择事件发生日期"; if (draft.administrativeArea?.trim() && !areaOptions.some((item) => item.label === draft.administrativeArea)) next.eventAdministrativeArea = "请从下拉结果中选择省 / 市 / 区县"; if (!draft.description.trim()) next.eventDescription = "请填写事件经过"; setErrors(next); return !next.eventOccurredDate && !next.eventAdministrativeArea && !next.eventDescription; }
  function openEventEditor(item?: ClaimPersonEvent) { const nextDraft = item ? eventDraftFrom(item) : emptyEvent(); const nextEditingId = item?.id ?? ""; setActiveSection("event"); setEditingEventId(nextEditingId); setEventDraft(nextDraft); setEventEditorOpen(true); setErrors((current) => { const next = { ...current }; delete next.eventOccurredDate; delete next.eventAdministrativeArea; delete next.eventDescription; return next; }); stateRef.current = { ...stateRef.current, editingEventId: nextEditingId, eventDraft: nextDraft }; if (item) setMessage(`正在编辑事件 ${item.eventNo}。`); return { type: "editor_opened", editor: "claim_event", mode: item ? "edit" : "create", eventId: item?.id, eventNo: item?.eventNo }; }
  function closeEventEditor() { setEventEditorOpen(false); setEditingEventId(""); setEventDraft(emptyEvent()); stateRef.current = { ...stateRef.current, editingEventId: "", eventDraft: emptyEvent() }; return { type: "editor_closed", editor: "claim_event" }; }
  async function createEvent(useRef = false, operationId?: string) { const current = useRef ? stateRef.current : { ...stateRef.current, insuredPersonId, editingEventId, eventDraft }; if (!current.insuredPersonId) { setMessage("请先锁定被保人，再新增事件。"); return { type: "operation_error", reason: "insured_required" }; } if (!validateEventDraft(current.eventDraft)) { setMessage("请补充事件信息中的必填项。"); return { type: "operation_error", reason: "event_required_fields_incomplete" }; } const isEditing = Boolean(current.editingEventId); setBusy(true); const response = await apiFetch("/api/claim-events", { method: isEditing ? "PUT" : "POST", headers: mutationHeaders(operationId), body: JSON.stringify({ ...(isEditing ? { id: current.editingEventId } : {}), insuredPersonId: current.insuredPersonId, ...current.eventDraft }) }); const result = await response.json() as ClaimPersonEvent & { message?: string }; setBusy(false); if (!response.ok) { setMessage(`${isEditing ? "修改" : "新增"}事件失败，请检查填写内容。`); return { type: "operation_error", reason: result.message ?? (isEditing ? "claim_event_update_failed" : "claim_event_create_failed") }; } const nextEvents = isEditing ? stateRef.current.personEvents.map((item) => item.id === result.id ? result : item) : [result, ...stateRef.current.personEvents]; const nextSelectedEventId = isEditing ? stateRef.current.selectedEventId : result.id; setPersonEvents(nextEvents); if (!isEditing) setSelectedEventId(result.id); setEventEditorOpen(false); setEditingEventId(""); setEventDraft(emptyEvent()); setErrors((currentErrors) => { const next = { ...currentErrors }; delete next.selectedEventId; return next; }); stateRef.current = { ...stateRef.current, personEvents: nextEvents, selectedEventId: nextSelectedEventId, editingEventId: "", eventDraft: emptyEvent() }; setMessage(isEditing ? `事件 ${result.eventNo} 修改已保存。` : `事件 ${result.eventNo} 已新增并自动关联。`); return { type: "mutation_result", operation: isEditing ? "update_event" : "create_event", success: true, eventId: result.id, eventNo: result.eventNo, associated: !isEditing }; }
  function selectEvent(item: ClaimPersonEvent) { setSelectedEventId(item.id); setErrors((current) => { const next = { ...current }; delete next.selectedEventId; return next; }); stateRef.current = { ...stateRef.current, selectedEventId: item.id }; setMessage(`已关联事件 ${item.eventNo}。`); return { type: "selection_result", eventId: item.id, eventNo: item.eventNo }; }

  async function uploadFiles(files: FileList | null) { if (!files?.length) return; setBusy(true); const uploaded: ClaimUpload[] = []; for (const file of Array.from(files)) { const form = new FormData(); form.append("file", file); form.append("category", "other"); const response = await apiFetch("/api/claim-attachments", { method: "POST", body: form }); const result = await response.json() as ClaimUpload & { message?: string }; if (response.ok) uploaded.push(result); else setMessage("影像上传失败，仅支持 JPG、PNG、WebP 和 PDF，单件不超过 10MB。"); } setAttachments((current) => [...current, ...uploaded]); setBusy(false); }
  async function removeAttachment(uploadId: string, operationId?: string) { const response = await apiFetch(`/api/claim-attachments?uploadId=${encodeURIComponent(uploadId)}`, { method: "DELETE", headers: { "Idempotency-Key": operationId ?? crypto.randomUUID() } }); if (!response.ok) return { type: "operation_error", reason: "attachment_delete_failed", itemId: uploadId }; const next = stateRef.current.attachments.filter((item) => item.uploadId !== uploadId); setAttachments(next); stateRef.current = { ...stateRef.current, attachments: next }; return { type: "mutation_result", operation: "remove_attachment", success: true, itemId: uploadId }; }

  useImperativeHandle(assistantRef, () => ({
    async setField(fieldId, value) {
      if (fieldId === "policyNo") { setPolicyNo(value.toUpperCase()); stateRef.current = { ...stateRef.current, policyNo: value.toUpperCase() }; }
      else if (fieldId === "insuredIdNo") { setInsuredIdNo(value.toUpperCase()); stateRef.current = { ...stateRef.current, insuredIdNo: value.toUpperCase() }; }
      else if (fieldId === "reportDate") { setReportDate(value); stateRef.current = { ...stateRef.current, reportDate: value }; }
      else if (fieldId === "reportChannel") { setReportChannel(value as ClaimReportChannel); stateRef.current = { ...stateRef.current, reportChannel: value as ClaimReportChannel }; }
      else if (fieldId === "remark") { setRemark(value); stateRef.current = { ...stateRef.current, remark: value }; }
      else if (fieldId === "applicantSameAsInsured") { const checked = value === "true"; const nextApplicant = checked ? copyParty(stateRef.current.insured, "applicant", "本人") : stateRef.current.applicant; setApplicantSameAsInsured(checked); if (checked) setApplicant(nextApplicant); stateRef.current = { ...stateRef.current, applicantSameAsInsured: checked, applicant: nextApplicant }; }
      else if (fieldId === "payeeSource") { const source = value as PayeeSource; const nextPayee = source === "insured" ? copyParty(stateRef.current.insured, "payee", "本人") : source === "applicant" ? copyParty(stateRef.current.applicant, "payee", stateRef.current.applicant.relationToInsured ?? "") : emptyParty("payee"); setPayeeSource(source); setPayee(nextPayee); stateRef.current = { ...stateRef.current, payeeSource: source, payee: nextPayee }; }
      else if (fieldId === "attachmentCategory") { setAttachmentCategory(value as ClaimAttachmentCategory); stateRef.current = { ...stateRef.current, attachmentCategory: value as ClaimAttachmentCategory }; }
      else if (fieldId === "eventKeyword") { setEventKeyword(value); stateRef.current = { ...stateRef.current, eventKeyword: value }; }
      else if (fieldId === "eventTypeFilter") { setEventTypeFilter(value as "all" | ClaimEventType); stateRef.current = { ...stateRef.current, eventTypeFilter: value as "all" | ClaimEventType }; }
      else if (fieldId === "eventDateFilter") { setEventDateFilter(value); stateRef.current = { ...stateRef.current, eventDateFilter: value }; }
      else if (fieldId === "eventType") { const draft = { ...stateRef.current.eventDraft, eventType: value as ClaimEventType }; setEventDraft(draft); stateRef.current = { ...stateRef.current, eventDraft: draft }; }
      else if (fieldId === "occurredDate" || fieldId === "administrativeArea" || fieldId === "detailedAddress" || fieldId === "hospitalName" || fieldId === "diagnosis" || fieldId === "eventDescription") { const key = fieldId === "eventDescription" ? "description" : fieldId; const draft = { ...stateRef.current.eventDraft, [key]: value }; setEventDraft(draft); stateRef.current = { ...stateRef.current, eventDraft: draft }; }
      else {
        const partyMap: Record<string, ["insured" | "applicant" | "payee", keyof PartyForm]> = {
          insuredName: ["insured", "name"], insuredGender: ["insured", "gender"], insuredBirthDate: ["insured", "birthDate"], insuredIdType: ["insured", "idType"], insuredPartyIdNo: ["insured", "idNo"], insuredIdValidFrom: ["insured", "idValidFrom"], insuredIdValidTo: ["insured", "idValidTo"], insuredIdLongTerm: ["insured", "idLongTerm"], insuredPhone: ["insured", "phone"], insuredAddress: ["insured", "address"],
          applicantName: ["applicant", "name"], applicantRelationToInsured: ["applicant", "relationToInsured"], applicantGender: ["applicant", "gender"], applicantBirthDate: ["applicant", "birthDate"], applicantIdType: ["applicant", "idType"], applicantIdNo: ["applicant", "idNo"], applicantIdValidFrom: ["applicant", "idValidFrom"], applicantIdValidTo: ["applicant", "idValidTo"], applicantIdLongTerm: ["applicant", "idLongTerm"], applicantPhone: ["applicant", "phone"], applicantAddress: ["applicant", "address"],
          payeeName: ["payee", "name"], payeeRelationToInsured: ["payee", "relationToInsured"], payeeGender: ["payee", "gender"], payeeBirthDate: ["payee", "birthDate"], payeeIdType: ["payee", "idType"], payeeIdNo: ["payee", "idNo"], payeeIdValidFrom: ["payee", "idValidFrom"], payeeIdValidTo: ["payee", "idValidTo"], payeeIdLongTerm: ["payee", "idLongTerm"], payeePhone: ["payee", "phone"], payeeAddress: ["payee", "address"], payeePaymentMethod: ["payee", "paymentMethod"], payeeBankName: ["payee", "bankName"], payeeBankAccountName: ["payee", "bankAccountName"], payeeBankAccountNo: ["payee", "bankAccountNo"],
        };
        const target = partyMap[fieldId];
        if (!target) return { type: "operation_error", reason: "field_executor_not_bound", fieldId };
        const currentParty = stateRef.current[target[0]];
        let resolvedValue: string | boolean = value;
        if (target[1] === "idLongTerm") resolvedValue = value === "true";
        if (target[1] === "idValidFrom" || target[1] === "idValidTo") {
          const resolvedDate = resolvePartyDateInput(value, String(currentParty[target[1]] ?? ""));
          if (!resolvedDate) return { type: "operation_error", reason: "invalid_or_incomplete_date", fieldId, value };
          resolvedValue = resolvedDate;
        }
        const party = {
          ...currentParty,
          [target[1]]: resolvedValue,
          ...(target[1] === "idLongTerm" && resolvedValue === true ? { idValidTo: "" } : {}),
          ...(target[1] === "idValidTo" && resolvedValue ? { idLongTerm: false } : {}),
        };
        if (target[0] === "insured") { setInsured(party); const nextApplicant = stateRef.current.applicantSameAsInsured ? copyParty(party, "applicant", "本人") : stateRef.current.applicant; const nextPayee = stateRef.current.payeeSource === "insured" ? copyParty(party, "payee", "本人") : stateRef.current.payee; if (stateRef.current.applicantSameAsInsured) setApplicant(nextApplicant); if (stateRef.current.payeeSource === "insured") setPayee(nextPayee); stateRef.current = { ...stateRef.current, insured: party, applicant: nextApplicant, payee: nextPayee }; }
        else if (target[0] === "applicant") { setApplicant(party); const nextPayee = stateRef.current.payeeSource === "applicant" ? copyParty(party, "payee", party.relationToInsured ?? "") : stateRef.current.payee; if (stateRef.current.payeeSource === "applicant") setPayee(nextPayee); stateRef.current = { ...stateRef.current, applicant: party, payee: nextPayee }; }
        else { setPayee(party); stateRef.current = { ...stateRef.current, payee: party }; }
        return { type: "field_updated", pageId: "claim_registration", fieldId, value: resolvedValue };
      }
      return { type: "field_updated", pageId: "claim_registration", fieldId, value };
    },
    async executeAction(actionId, options) { if (actionId === "lock_insured") return lockPolicyInsured(); if (actionId === "reset_event_filters") { setEventKeyword(""); setEventTypeFilter("all"); setEventDateFilter(""); stateRef.current = { ...stateRef.current, eventKeyword: "", eventTypeFilter: "all", eventDateFilter: "" }; return { type: "filter_reset", region: "claim_event_information" }; } if (actionId === "open_event_editor") return openEventEditor(); if (actionId === "close_event_editor") return closeEventEditor(); if (actionId === "create_event") return createEvent(true, options?.operationId); if (actionId === "save_case") return saveCase(true, options?.operationId); if (actionId === "cancel_case") { if (!stateRef.current.editingCaseId) return { type: "operation_error", reason: "claim_case_required" }; setCancelPromptOpen(true); return { type: "confirmation_required", operation: "cancel_case", caseId: stateRef.current.editingCaseId }; } if (actionId === "submit_case") return changeStatus("submit", options?.operationId); if (actionId === "reset" || actionId === "new_case") return resetForm(actionId); return { type: "operation_error", reason: "action_executor_not_bound", actionId }; },
    async executeRowAction(actionId, row, options) { if (actionId === "edit_case") { const item = stateRef.current.cases[row - 1]; return item ? openCase(item) : { type: "operation_error", reason: "row_not_found", row }; } if (actionId === "select_event" || actionId === "edit_event") { const current = stateRef.current; const visible = current.personEvents.filter((item) => current.eventTypeFilter === "all" || item.eventType === current.eventTypeFilter).filter((item) => !current.eventDateFilter || item.occurredDate === current.eventDateFilter).filter((item) => { const key = current.eventKeyword.trim().toLowerCase(); return !key || [item.eventNo, item.administrativeArea, item.detailedAddress, item.hospitalName, item.diagnosis, item.description].some((value) => value?.toLowerCase().includes(key)); }); const item = visible[row - 1]; return item ? (actionId === "edit_event" ? openEventEditor(item) : selectEvent(item)) : { type: "operation_error", reason: "row_not_found", row }; } if (actionId === "remove_attachment") { const item = stateRef.current.attachments[row - 1]; return item ? removeAttachment(item.uploadId, options?.operationId) : { type: "operation_error", reason: "row_not_found", row }; } return { type: "operation_error", reason: "row_action_executor_not_bound", actionId, row }; },
    async executeItemAction(actionId, itemId, options) { if (actionId === "edit_case") { const item = stateRef.current.cases.find((candidate) => candidate.id === itemId) ?? (await loadCases()).find((candidate) => candidate.id === itemId); return item ? openCase(item) : { type: "operation_error", reason: "item_not_found", itemId }; } if (actionId === "select_event" || actionId === "edit_event") { const item = stateRef.current.personEvents.find((candidate) => candidate.id === itemId); return item ? (actionId === "edit_event" ? openEventEditor(item) : selectEvent(item)) : { type: "operation_error", reason: "item_not_found", itemId }; } if (actionId === "remove_attachment") { const item = stateRef.current.attachments.find((candidate) => candidate.uploadId === itemId); return item ? removeAttachment(item.uploadId, options?.operationId) : { type: "operation_error", reason: "item_not_found", itemId }; } return { type: "operation_error", reason: "item_action_executor_not_bound", actionId, itemId }; },
    getRuntimeFieldOptions() { return {}; },
  }));

  const activeCase = editingCaseId ? cases.find((item) => item.id === editingCaseId) ?? (embeddedCase?.id === editingCaseId ? embeddedCase : null) : null;
  const activeCaseInsured = activeCase?.parties.find((party) => party.role === "insured");

  return <div ref={imageStageRef} className={`claim-image-push-stage ${attachmentsOpen ? "image-open" : ""}`}>
    {!compactEmbedded ? <ClaimImageWorkspace
      open={attachmentsOpen}
      caseNo={activeCase?.caseNo}
      attachments={attachments}
      busy={busy}
      disabled={formDisabled}
      readOnly={readOnly}
      uploadInHeader
      onClose={() => setAttachmentsOpen(false)}
      onUpload={(files) => void uploadFiles(files)}
      onRemove={(uploadId) => void removeAttachment(uploadId)}
    /> : null}
    <div className={`claim-registration-page ${compactEmbedded ? "compact-embedded" : ""}`}>
    {successNotice ? <div className="claim-success-toast" role="status" aria-live="polite"><span aria-hidden="true">✓</span><strong>{successNotice}</strong></div> : null}
    {cancelPromptOpen && activeCase ? (
      <div className="bill-attachment-change-overlay">
        <div className="bill-attachment-change-dialog" role="dialog" aria-modal="true" aria-labelledby="registration-cancel-title">
          <div className="section-title" id="registration-cancel-title">确认撤件</div>
          <p>确定撤销案件 <strong>{activeCase.caseNo}</strong> 吗？撤件后案件将不再进入后续理算流程。</p>
          <div className="bill-attachment-change-actions">
            <button type="button" className="danger-button" disabled={busy} onClick={() => void changeStatus("cancel")}>确认撤件</button>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => setCancelPromptOpen(false)}>取消</button>
          </div>
        </div>
      </div>
    ) : null}

    {!embeddedCase ? <section ref={caseListPanelRef} className={`panel claim-case-list-panel ${caseListExpanded ? "" : "collapsed"}`}>
      <div className="panel-title-row">
        <div>
          <div className="section-title">受理案件</div>
          <small className="muted">{caseListExpanded ? "双击案件进入编辑或查看" : `已收起，共 ${cases.length} 个案件`}</small>
        </div>
        <div className="claim-case-list-actions">
          <button type="button" className="secondary-button" onClick={() => setCaseListExpanded((expanded) => !expanded)}>{caseListExpanded ? "收起列表" : "展开列表"}</button>
          <button type="button" onClick={() => { resetForm("new_case"); setCaseListExpanded(false); }}>新建立案</button>
        </div>
      </div>
      {caseListExpanded ? <div className="table-wrapper claim-case-list"><table><thead><tr><th>案件号</th><th>保单号</th><th>被保人</th><th>证件号</th><th>关联事件</th><th>报案日期</th><th>状态</th><th>更新时间</th></tr></thead><tbody>{cases.length ? cases.map((item) => { const party = item.parties.find((entry) => entry.role === "insured"); return <tr key={item.id} className={editingCaseId === item.id ? "active-row" : ""} onDoubleClick={() => void openCase(item)}><td><strong>{item.caseNo}</strong></td><td>{item.policyNo}</td><td>{party?.name ?? "-"}</td><td>{party?.idNo ?? "-"}</td><td>{item.event.eventNo}</td><td>{item.reportDate}</td><td><span className={`status-badge claim-${item.status}`}>{claimStatusLabels[item.status]}</span></td><td>{new Date(item.updatedAt).toLocaleString("zh-CN", { hour12: false })}</td></tr>; }) : <tr><td colSpan={8} className="config-empty-cell">暂无已立案案件</td></tr>}</tbody></table></div> : null}
    </section> : null}

    {!compactEmbedded ? <section className="panel claim-page-header">
      <div className="claim-page-header-title">
        <div className="section-title">{activeCase ? `案件信息 · ${activeCase.caseNo}` : "受理立案"}</div>
        <p className="config-intro">{activeCase ? `${activeCase.policyNo} ｜ ${activeCaseInsured?.name ?? "-"} ｜ ${activeCase.event.eventNo}` : "只需输入被保人证件号，系统会查询并选择其关联保单。"}</p>
      </div>
      {!readOnly ? <div className="claim-registration-top-actions">
        {activeCase ? <button type="button" className="secondary-button" disabled={busy || !editingCaseId || editingStatus !== "registered"} onClick={() => setCancelPromptOpen(true)}>撤件</button> : null}
        <button type="button" disabled={busy || formDisabled} onClick={() => void saveCase(false)}>{editingCaseId ? "保存修改" : "保存立案"}</button>
        {activeCase ? <button type="button" className="claim-submit-button" disabled={busy || !editingCaseId || editingStatus !== "registered"} onClick={() => void changeStatus("submit")}>提交</button> : null}
      </div> : null}
      {activeCase ? <div className="claim-case-overview">
        <div className="claim-case-overview-status"><span>案件状态</span><strong>{claimStatusLabels[activeCase.status]}</strong></div>
        <div><span>当前处理人</span><strong>{activeCase.currentHandlerName}</strong><small>{activeCase.currentHandlerUserId}</small></div>
        <div><span>被保人</span><strong>{activeCaseInsured?.name ?? "-"}</strong><small>{activeCaseInsured?.idNo ?? "-"}</small></div>
        <div><span>关联事件</span><strong>{activeCase.event.eventNo}</strong><small>{activeCase.event.diagnosis || eventTypeOptions.find((option) => option.value === activeCase.event.eventType)?.label}</small></div>
        <div><span>报案信息</span><strong>{activeCase.reportDate}</strong><small>{reportChannelOptions.find((option) => option.value === activeCase.reportChannel)?.label}</small></div>
        <div><span>最后更新</span><strong>{new Date(activeCase.updatedAt).toLocaleDateString("zh-CN")}</strong><small>{new Date(activeCase.updatedAt).toLocaleTimeString("zh-CN", { hour12: false })}</small></div>
      </div> : null}
    </section> : null}
    {!compactEmbedded && message ? <div className={`config-message standalone ${/成功|已锁定|已保存|已提交|已撤件|已新增|已关联/.test(message) ? "success" : ""}`} aria-live="polite">{message}</div> : null}

    <div className="claim-registration-workspace">
      {!compactEmbedded ? <aside className="panel claim-registration-nav">
        {([
          ["attachments", "07", "影像件", `${attachments.length} 件资料`],
          ["basic", "01", "立案信息", policy ? "承保关系已锁定" : "待锁定承保关系"],
          ["insured", "02", "被保人信息", insured.name || "待录入"],
          ["applicant", "03", "申请人信息", applicant.name || "待录入"],
          ["payee", "04", "领款人信息", payee.name || "待录入"],
          ["event", "05", "事件信息", selectedEventId ? "已关联事件" : "待关联事件"],
          ["remark", "06", "案件备注", caseRemarks.length ? `${caseRemarks.length} 条备注` : remark.trim() ? "待保存备注" : "暂无备注"],
        ] as Array<[RegistrationSection, string, string, string]>).map(([section, number, label, summary]) => (
          <button type="button" className={section === "attachments" ? (attachmentsOpen ? "active" : "") : (displayedSection === section ? "active" : "")} key={section} onClick={() => { if (section === "attachments") setAttachmentsOpen((open) => !open); else setActiveSection(section); }}>
            <span>{number}</span><div><strong>{label}</strong><small>{summary}</small></div>
          </button>
        ))}
      </aside> : null}

      <div className="claim-registration-main">
        {displayedSection === "basic" ? <><section className="panel claim-form-panel"><div className="section-title">立案信息</div><div className="claim-form-grid">
          <label><span>被保人证件号 <Required /></span><input className={errors.insuredIdNo ? "invalid" : ""} disabled={Boolean(editingCaseId)} value={insuredIdNo} onChange={(event) => setInsuredIdNo(event.target.value.toUpperCase())} /><FieldError message={errors.insuredIdNo} /></label>
          <label className="claim-lock-action"><span>关联保单</span><button type="button" disabled={Boolean(editingCaseId) || busy} onClick={() => void lockPolicyInsured()}>{busy ? "查询中…" : policy ? "重新查询" : "查询关联保单"}</button><FieldError message={errors.policyNo} /></label>
          <label><span>报案日期 <Required /></span><AppDatePicker ariaLabel="报案日期" disabled={formDisabled} invalid={Boolean(errors.reportDate)} value={reportDate} onChange={setReportDate} /><FieldError message={errors.reportDate} /></label>
          <label><span>报案渠道</span><AppSelect ariaLabel="报案渠道" disabled={formDisabled} value={reportChannel} options={reportChannelOptions} onChange={setReportChannel} /></label>
          {policyCandidates.length > 1 ? <div className="claim-policy-candidates claim-full-field">
            <div className="panel-title-row"><strong>请选择本次理赔保单</strong><small className="muted">共 {policyCandidates.length} 张关联保单</small></div>
            <div className="table-wrapper"><table><thead><tr><th>保单号</th><th>保单名称</th><th>投保单位</th><th>保障期间</th><th>状态</th><th>操作</th></tr></thead><tbody>
              {policyCandidates.map((item) => <tr key={item.id} className={policy?.id === item.id ? "active-row" : ""}><td><strong>{item.policyNo}</strong></td><td>{item.policyName}</td><td>{item.applicantName}</td><td>{item.effectiveDate} ~ {item.expiryDate}</td><td>{item.policyStatus === "enabled" ? "启用" : "停用"}</td><td><button type="button" className={policy?.id === item.id ? "event-associated-button" : "action-link"} disabled={busy || policy?.id === item.id} onClick={() => void selectPolicyInsured(item)}>{policy?.id === item.id ? "已选择" : "选择"}</button></td></tr>)}
            </tbody></table></div>
          </div> : null}
          {policy ? <div className="claim-policy-summary claim-wide-field"><span>当前保单：{policy.policyNo}</span><strong>{policy.policyName}</strong><small>{policy.applicantName} ｜ 保障期间 {policy.effectiveDate} ~ {policy.expiryDate}</small></div> : null}
        </div></section>
        {editingCaseId ? <section className="panel claim-form-panel claim-transition-panel"><div className="panel-title-row"><div><div className="section-title">案件流转记录</div><small className="muted">按发生时间记录案件从创建到结案的状态变化和操作人。</small></div></div>
          <div className="table-wrapper"><table><thead><tr><th>流转动作</th><th>流转前</th><th>流转后</th><th>操作人</th><th>流转给</th><th>发生时间</th><th>说明</th></tr></thead><tbody>
            {activeCase?.transitions?.length ? activeCase.transitions.map((item) => <tr key={item.id}><td><strong>{claimTransitionActionLabels[item.action]}</strong></td><td>{item.fromStatus ? claimStatusLabels[item.fromStatus] : "-"}</td><td><span className={`status-badge claim-${item.toStatus}`}>{claimStatusLabels[item.toStatus]}</span></td><td>{item.operatorName}</td><td>{item.targetUserName}</td><td>{new Date(item.occurredAt).toLocaleString("zh-CN", { hour12: false })}</td><td>{item.description ?? "-"}</td></tr>) : <tr><td colSpan={7} className="config-empty-cell">暂无流转记录</td></tr>}
          </tbody></table></div>
        </section> : null}</> : null}

        {displayedSection === "insured" ? <PartySection title="被保人信息" prefix="insuredParty" value={insured} errors={errors} formDisabled={formDisabled} onChange={(next) => { setInsured(next); if (applicantSameAsInsured) setApplicant(copyParty(next, "applicant", "本人")); if (payeeSource === "insured") setPayee(copyParty(next, "payee", "本人")); }} /> : null}

        {displayedSection === "applicant" ? <PartySection title="申请人信息" prefix="applicant" value={applicant} errors={errors} identityDisabled={applicantSameAsInsured} formDisabled={formDisabled} onChange={setApplicant} extra={<label className="claim-header-check"><input type="checkbox" disabled={formDisabled} checked={applicantSameAsInsured} onChange={(event) => { setApplicantSameAsInsured(event.target.checked); if (event.target.checked) setApplicant(copyParty(insured, "applicant", "本人")); }} />同被保人</label>} /> : null}

        {displayedSection === "payee" ? <PartySection title="领款人信息" prefix="payee" value={payee} errors={errors} identityDisabled={payeeSource !== "other"} formDisabled={formDisabled} showBank onChange={setPayee} extra={<label className="claim-header-source">信息来源<AppSelect ariaLabel="领款人信息来源" disabled={formDisabled} value={payeeSource} options={payeeSourceOptions} onChange={(source) => { setPayeeSource(source); if (source === "insured") setPayee(copyParty(insured, "payee", "本人")); else if (source === "applicant") setPayee(copyParty(applicant, "payee", applicant.relationToInsured ?? "")); else setPayee(emptyParty("payee")); }} /></label>} /> : null}

        {displayedSection === "event" ? <section className="panel claim-form-panel claim-event-panel"><div className="panel-title-row"><div><div className="section-title">事件信息 <Required /></div><small className="muted">{readOnly ? "显示受理时的事件信息" : "显示当前被保人的全部事件；可关联或编辑事件"}</small></div>{!readOnly ? <button type="button" disabled={!insuredPersonId || formDisabled} onClick={() => openEventEditor()}>新增事件</button> : null}</div>
          <div className="claim-event-filters"><input aria-label="事件关键词筛选" value={eventKeyword} onChange={(event) => setEventKeyword(event.target.value)} /><AppSelect ariaLabel="事件类型筛选" value={eventTypeFilter} options={eventFilterOptions} onChange={setEventTypeFilter} /><AppDatePicker ariaLabel="事件日期筛选" value={eventDateFilter} onChange={setEventDateFilter} /><button type="button" className="secondary-button" onClick={() => { setEventKeyword(""); setEventTypeFilter("all"); setEventDateFilter(""); }}>清空筛选</button></div>
          <div className={`table-wrapper claim-event-list ${errors.selectedEventId ? "invalid-panel" : ""}`}><table><thead><tr><th>关联</th><th>事件号</th><th>被保人姓名</th><th>类型</th><th>发生日期</th><th>行政区</th><th>医院</th><th>诊断</th><th>事件经过</th><th>操作</th></tr></thead><tbody>{filteredEvents.length ? filteredEvents.map((item) => <tr key={item.id} className={selectedEventId === item.id ? "active-row" : ""} onDoubleClick={() => { if (!formDisabled) openEventEditor(item); }}><td><button type="button" className={selectedEventId === item.id ? "event-associated-button" : "secondary-button"} disabled={formDisabled} onClick={() => selectEvent(item)}>{selectedEventId === item.id ? "已关联" : "关联"}</button></td><td><strong>{item.eventNo}</strong></td><td>{insured.name || "-"}</td><td>{eventTypeOptions.find((option) => option.value === item.eventType)?.label}</td><td>{item.occurredDate}</td><td>{item.administrativeArea || "-"}</td><td>{item.hospitalName || "-"}</td><td>{item.diagnosis || "-"}</td><td>{item.description}</td><td><button type="button" className="action-link" disabled={formDisabled} onClick={() => openEventEditor(item)}>编辑</button></td></tr>) : <tr><td colSpan={10} className="config-empty-cell">{insuredPersonId ? "没有符合筛选条件的事件" : "请先锁定被保人"}</td></tr>}</tbody></table></div><FieldError message={errors.selectedEventId} />
          {eventEditorOpen ? <div className="claim-event-editor"><div className="panel-title-row"><div className="section-title">{editingEventId ? "编辑事件" : "新增事件"}</div><button type="button" className="secondary-button" onClick={() => closeEventEditor()}>取消{editingEventId ? "编辑" : "新增"}</button></div><div className="claim-form-grid">
            <label><span>事件类型 <Required /></span><AppSelect ariaLabel="新增事件类型" disabled={formDisabled} value={eventDraft.eventType} options={eventTypeOptions} onChange={(value) => setEventDraft((current) => ({ ...current, eventType: value }))} /></label>
            <label><span>事件发生日期 <Required /></span><AppDatePicker ariaLabel="事件发生日期" disabled={formDisabled} invalid={Boolean(errors.eventOccurredDate)} value={eventDraft.occurredDate} onChange={(next) => setEventDraft((current) => ({ ...current, occurredDate: next }))} /><FieldError message={errors.eventOccurredDate} /></label>
            <label className="claim-wide-field"><span>发生地点（省/市/区县）</span><AppCombobox ariaLabel="发生地点" disabled={formDisabled} invalid={Boolean(errors.eventAdministrativeArea)} value={eventDraft.administrativeArea ?? ""} options={areaOptions} onChange={(value) => setEventDraft((current) => ({ ...current, administrativeArea: value }))} placeholder="" /><FieldError message={errors.eventAdministrativeArea} /></label>
            <label className="claim-wide-field"><span>详细地点</span><input disabled={formDisabled} value={eventDraft.detailedAddress ?? ""} onChange={(event) => setEventDraft((current) => ({ ...current, detailedAddress: event.target.value }))} /></label>
            <label><span>就诊医院</span><input disabled={formDisabled} value={eventDraft.hospitalName ?? ""} onChange={(event) => setEventDraft((current) => ({ ...current, hospitalName: event.target.value }))} /></label>
            <label><span>诊断</span><input disabled={formDisabled} value={eventDraft.diagnosis ?? ""} onChange={(event) => setEventDraft((current) => ({ ...current, diagnosis: event.target.value }))} /></label>
            <label className="claim-wide-field"><span>事件经过 <Required /></span><textarea className={errors.eventDescription ? "invalid" : ""} disabled={formDisabled} value={eventDraft.description} onChange={(event) => setEventDraft((current) => ({ ...current, description: event.target.value }))} /><FieldError message={errors.eventDescription} /></label>
          </div><div className="claim-event-editor-actions"><button type="button" disabled={busy || formDisabled} onClick={() => void createEvent(false)}>{editingEventId ? "保存事件修改" : "保存事件并关联"}</button></div></div> : null}
        </section> : null}

        {displayedSection === "remark" ? <section className="panel claim-form-panel claim-remark-panel">
          <div className="panel-title-row">
            <div>
              <div className="section-title">案件备注</div>
              <small className="muted">记录本案受理、理算和审核过程中需要持续关注的补充事项。</small>
            </div>
          </div>
          <div className="table-wrapper claim-remark-list"><table><thead><tr><th>环节</th><th>备注内容</th><th>添加时间</th></tr></thead><tbody>
            {caseRemarks.length ? caseRemarks.map((item) => <tr key={item.id}><td><span className="status-badge">{claimRemarkStageLabels[item.stage]}</span></td><td>{item.content}</td><td>{new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })}</td></tr>) : <tr><td colSpan={3} className="config-empty-cell">暂无案件备注</td></tr>}
          </tbody></table></div>
          {allowRemarkAdd ? editingCaseId ? <div className="claim-remark-add">
            <label><span>新增{claimRemarkStageLabels[remarkStage]}备注</span><textarea value={newRemark} onChange={(event) => setNewRemark(event.target.value)} placeholder="填写本环节需要持续关注的补充事项" /></label>
            <div><button type="button" disabled={remarkBusy || !newRemark.trim()} onClick={() => void addCaseRemark()}>{remarkBusy ? "正在新增…" : "新增备注"}</button></div>
          </div> : <label><span>首条受理备注</span><textarea value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="保存立案时将作为第一条备注记录" /><small className="muted">保存立案后自动加入备注列表。</small></label> : null}
        </section> : null}

        {displayedSection === "attachments" ? <section className="panel claim-form-panel claim-last-panel"><div className="panel-title-row"><div><div className="section-title">影像资料</div><small className="muted">{readOnly ? "仅供审核查看" : "支持 JPG、PNG、WebP、PDF"}</small></div>{!readOnly ? <label className={`claim-upload-button ${formDisabled ? "disabled" : ""}`}>上传影像<input disabled={formDisabled} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => { void uploadFiles(event.target.files); event.target.value = ""; }} /></label> : null}</div><div className="claim-attachment-list">{attachments.length ? attachments.map((item) => <div key={item.uploadId}><strong>{item.fileName}</strong><small>{(item.fileSize / 1024).toFixed(1)} KB</small>{!readOnly ? <button disabled={formDisabled} type="button" className="danger-link" onClick={() => void removeAttachment(item.uploadId)}>删除</button> : null}</div>) : <div className="claim-empty-upload">暂无影像资料</div>}</div></section> : null}
      </div>
    </div>

    {!readOnly && compactEmbedded ? <div className="claim-fixed-actions">
      <button type="button" disabled={busy || formDisabled} onClick={() => void saveCase(false)}>保存受理信息</button>
    </div> : null}
    </div>
  </div>;
});

export default ClaimRegistrationPage;
