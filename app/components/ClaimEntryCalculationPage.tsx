"use client";

import { useEffect, useMemo, useState } from "react";
import type { ClaimCase, ClaimUpload } from "../../src/claims/types";
import { apiFetch } from "../../src/api/client";
import AppDatePicker from "./AppDatePicker";
import AppSelect, { type AppSelectOption } from "./AppSelect";
import ClaimRegistrationPage from "./ClaimRegistrationPage";
import ClaimImageWorkspace from "./ClaimImageWorkspace";
import type { AutomaticCalculationResult, BenefitFormulaView, CalculationVariableView, LedgerBalanceView } from "../../src/calculation/automation-types";

type EntryTab = "bill" | "event" | "disease";
type EntryWorkflowStatus = "editing" | "calculated";

type BillEntry = {
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
  customValues: Record<string, string | number | boolean>;
  selectedBenefitIds: string[];
  createdAt: string;
  updatedAt: string;
};

type EventEntry = {
  id: string;
  eventType: string;
  occurredDate: string;
  location: string;
  description: string;
};

type DiseaseEntry = {
  id: string;
  diseaseName: string;
  icdCode: string;
  diagnosisDate: string;
  hospital: string;
  note: string;
};

type CaseEntryData = {
  bills: BillEntry[];
  events: EventEntry[];
  diseases: DiseaseEntry[];
};

type ProcessingCaseResult = {
  items: ClaimCase[];
  total: number;
};

type AutomationBenefit = {
  id: string;
  code: string;
  name: string;
  productId: string;
  planId?: string;
  productName: string;
};

const billTypeOptions: AppSelectOption<string>[] = [
  { value: "outpatient", label: "门诊账单" },
  { value: "inpatient", label: "住院账单" },
  { value: "pharmacy", label: "药店购药" },
  { value: "other", label: "其他费用" },
];

const medicalInsuranceTypeOptions: AppSelectOption<string>[] = [
  { value: "employee", label: "城镇职工基本医疗保险" },
  { value: "resident", label: "城乡居民基本医疗保险" },
  { value: "new_rural", label: "新型农村合作医疗" },
  { value: "commercial", label: "商业健康保险" },
  { value: "self_pay", label: "全自费" },
  { value: "other", label: "其他" },
];

const eventTypeOptions: AppSelectOption<string>[] = [
  { value: "disease", label: "疾病" },
  { value: "accident", label: "意外" },
  { value: "other", label: "其他" },
];

function newId() {
  return crypto.randomUUID();
}

function money(value: number) {
  return value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function emptyBillForm(patientName = "", patientIdNo = "") {
  return {
    invoiceCode: "",
    invoiceNo: "",
    checkCode: "",
    billType: "outpatient",
    patientName,
    patientIdNo,
    visitNo: "",
    institution: "",
    department: "",
    billDate: "",
    admissionDate: "",
    dischargeDate: "",
    diagnosis: "",
    medicalInsuranceType: "employee",
    settlementNo: "",
    totalAmount: "",
    insuranceFundAmount: "",
    personalAccountAmount: "",
    cashAmount: "",
    selfPaidAmount: "",
    cashier: "",
  };
}

export default function ClaimEntryCalculationPage() {
  const [activeTab, setActiveTab] = useState<EntryTab>("bill");
  const [acceptanceEditOpen, setAcceptanceEditOpen] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [processingCases, setProcessingCases] = useState<ClaimCase[]>([]);
  const [selectedCase, setSelectedCase] = useState<ClaimCase | null>(null);
  const [caseKeyword, setCaseKeyword] = useState("");
  const [caseLoading, setCaseLoading] = useState(true);
  const [caseError, setCaseError] = useState("");
  const [entriesByCase, setEntriesByCase] = useState<Record<string, CaseEntryData>>({});
  const [workflowByCase, setWorkflowByCase] = useState<Record<string, EntryWorkflowStatus>>({});
  const [automationBenefits, setAutomationBenefits] = useState<AutomationBenefit[]>([]);
  const [automationFormulas, setAutomationFormulas] = useState<BenefitFormulaView[]>([]);
  const [automationVariables, setAutomationVariables] = useState<CalculationVariableView[]>([]);
  const [selectedBenefitIds, setSelectedBenefitIds] = useState<string[]>([]);
  const [customBillValues, setCustomBillValues] = useState<Record<string, string>>({});
  const [ledgerBalances, setLedgerBalances] = useState<LedgerBalanceView[]>([]);
  const [calculationResult, setCalculationResult] = useState<AutomaticCalculationResult | null>(null);
  const [billForm, setBillForm] = useState(() => emptyBillForm());
  const [eventForm, setEventForm] = useState({
    eventType: "disease",
    occurredDate: "",
    location: "",
    description: "",
  });
  const [diseaseForm, setDiseaseForm] = useState({
    diseaseName: "",
    icdCode: "",
    diagnosisDate: "",
    hospital: "",
    note: "",
  });

  const currentEntries = selectedCase ? entriesByCase[selectedCase.id] : undefined;
  const bills = currentEntries?.bills ?? [];
  const events = currentEntries?.events ?? [];
  const diseases = currentEntries?.diseases ?? [];
  const customBillVariables = automationVariables.filter((variable) => variable.category === "bill" && variable.custom && variable.enabled);
  const workflowStatus = selectedCase ? workflowByCase[selectedCase.id] ?? "editing" : "editing";
  const filteredCases = useMemo(() => {
    const keyword = caseKeyword.trim().toLowerCase();
    if (!keyword) return processingCases;
    return processingCases.filter((item) => {
      const insured = item.parties.find((party) => party.role === "insured");
      return [item.caseNo, item.policyNo, insured?.name, insured?.idNo, item.event.eventNo]
        .some((value) => value?.toLowerCase().includes(keyword));
    });
  }, [caseKeyword, processingCases]);

  const totals = useMemo(() => {
    const total = bills.reduce((sum, item) => sum + item.totalAmount, 0);
    const selfPaid = bills.reduce((sum, item) => sum + item.selfPaidAmount, 0);
    return { total, selfPaid, eligible: Math.max(0, total - selfPaid) };
  }, [bills]);

  async function loadProcessingCases() {
    setCaseLoading(true);
    setCaseError("");
    try {
      const response = await apiFetch("/api/claim-registrations?status=processing&page=1&pageSize=100", { cache: "no-store" });
      if (!response.ok) throw new Error("processing_cases_failed");
      const result = await response.json() as ProcessingCaseResult;
      setProcessingCases(result.items);
      if (selectedCase) {
        const refreshed = result.items.find((item) => item.id === selectedCase.id);
        setSelectedCase(refreshed ?? null);
      }
    } catch {
      setProcessingCases([]);
      setCaseError("待处理案件加载失败，请稍后重试。");
    } finally {
      setCaseLoading(false);
    }
  }

  useEffect(() => {
    void loadProcessingCases();
    const refresh = () => { void loadProcessingCases(); };
    window.addEventListener("claim-case-status-changed", refresh);
    return () => window.removeEventListener("claim-case-status-changed", refresh);
  }, []);

  function updateCaseEntries<K extends keyof CaseEntryData>(
    key: K,
    update: (items: CaseEntryData[K]) => CaseEntryData[K],
  ) {
    if (!selectedCase) return;
    setEntriesByCase((current) => {
      const existing = current[selectedCase.id] ?? { bills: [], events: [], diseases: [] };
      return { ...current, [selectedCase.id]: { ...existing, [key]: update(existing[key]) } };
    });
  }

  function setBills(update: (items: BillEntry[]) => BillEntry[]) {
    updateCaseEntries("bills", update);
  }

  function setEvents(update: (items: EventEntry[]) => EventEntry[]) {
    updateCaseEntries("events", update);
  }

  function setDiseases(update: (items: DiseaseEntry[]) => DiseaseEntry[]) {
    updateCaseEntries("diseases", update);
  }

  function openCase(item: ClaimCase) {
    const insuredParty = item.parties.find((party) => party.role === "insured");
    setSelectedCase(item);
    setActiveTab("bill");
    setAcceptanceEditOpen(false);
    setAttachmentsOpen(false);
    setBillForm(emptyBillForm(insuredParty?.name ?? "", insuredParty?.idNo ?? ""));
    setEventForm({ eventType: item.event.eventType, occurredDate: item.event.occurredDate, location: item.event.detailedAddress ?? item.event.administrativeArea ?? "", description: "" });
    setDiseaseForm({ diseaseName: item.event.diagnosis ?? "", icdCode: "", diagnosisDate: item.event.occurredDate, hospital: item.event.hospitalName ?? "", note: "" });
    setSelectedBenefitIds([]);
    setCustomBillValues({});
    setCalculationResult(null);
    void loadCaseAutomation(item);
  }

  async function loadCaseAutomation(item: ClaimCase) {
    const response = await apiFetch(`/api/automatic-calculation?policyId=${encodeURIComponent(item.policyId)}&claimCaseId=${encodeURIComponent(item.id)}`, { cache: "no-store" });
    if (!response.ok) {
      flash("自动理算配置加载失败，请稍后重试。");
      return;
    }
    const data = await response.json() as {
      benefits: AutomationBenefit[];
      formulas: BenefitFormulaView[];
      variables: CalculationVariableView[];
      bills: BillEntry[];
      ledgerBalances: LedgerBalanceView[];
      latestResult: AutomaticCalculationResult | null;
    };
    setAutomationBenefits(data.benefits);
    setAutomationFormulas(data.formulas);
    setAutomationVariables(data.variables);
    setLedgerBalances(data.ledgerBalances);
    if (data.latestResult?.claimCaseId === item.id) setCalculationResult(data.latestResult);
    setEntriesByCase((current) => ({
      ...current,
      [item.id]: {
        bills: data.bills,
        events: current[item.id]?.events ?? [],
        diseases: current[item.id]?.diseases ?? [],
      },
    }));
    const defaults = Object.fromEntries(data.variables.filter((variable) => variable.category === "bill" && variable.custom).map((variable) => [variable.variableName, variable.defaultValue ?? ""]));
    setCustomBillValues(defaults);
  }

  function flash(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage(""), 2400);
  }

  async function saveCaseAttachments(currentCase: ClaimCase, attachments: ClaimUpload[]) {
    const response = await apiFetch("/api/claim-registrations", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        id: currentCase.id,
        policyId: currentCase.policyId,
        policyInsuredId: currentCase.policyInsuredId,
        reportDate: currentCase.reportDate,
        reportChannel: currentCase.reportChannel,
        remark: currentCase.remark ?? "",
        parties: currentCase.parties,
        eventId: currentCase.eventId,
        attachments,
      }),
    });
    if (!response.ok) throw new Error("attachment_save_failed");
    const updated = await response.json() as ClaimCase;
    setSelectedCase(updated);
    setProcessingCases((items) => items.map((item) => item.id === updated.id ? updated : item));
    return updated;
  }

  async function uploadCalculationAttachments(files: FileList | null) {
    if (!selectedCase || !files?.length) return;
    setAttachmentBusy(true);
    const uploaded: ClaimUpload[] = [];
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        form.append("category", "other");
        const response = await apiFetch("/api/claim-attachments", { method: "POST", body: form });
        if (!response.ok) throw new Error("attachment_upload_failed");
        uploaded.push(await response.json() as ClaimUpload);
      }
      await saveCaseAttachments(selectedCase, [...selectedCase.attachments, ...uploaded]);
      flash(`已上传 ${uploaded.length} 件影像，并保存到当前案件。`);
    } catch {
      flash("影像上传失败，仅支持 JPG、PNG、WebP 和 PDF，单件不超过 10MB。");
    } finally {
      setAttachmentBusy(false);
    }
  }

  async function removeCalculationAttachment(uploadId: string) {
    if (!selectedCase) return;
    setAttachmentBusy(true);
    try {
      await apiFetch(`/api/claim-attachments?uploadId=${encodeURIComponent(uploadId)}`, {
        method: "DELETE",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      await saveCaseAttachments(selectedCase, selectedCase.attachments.filter((item) => item.uploadId !== uploadId));
      flash("影像件已删除。");
    } catch {
      flash("影像件删除失败，请稍后重试。");
    } finally {
      setAttachmentBusy(false);
    }
  }

  async function addBill() {
    const totalAmount = Number(billForm.totalAmount);
    const selfPaidAmount = Number(billForm.selfPaidAmount || 0);
    const insuranceFundAmount = Number(billForm.insuranceFundAmount || 0);
    const personalAccountAmount = Number(billForm.personalAccountAmount || 0);
    const cashAmount = Number(billForm.cashAmount || 0);
    if (!billForm.invoiceNo.trim() || !billForm.patientName.trim() || !billForm.institution.trim() || !billForm.billDate || !Number.isFinite(totalAmount) || totalAmount <= 0) {
      flash("请填写票据号码、患者姓名、医疗机构、收费日期和有效的医疗总费用。");
      return;
    }
    if ([selfPaidAmount, insuranceFundAmount, personalAccountAmount, cashAmount].some((value) => !Number.isFinite(value) || value < 0 || value > totalAmount)) {
      flash("各支付金额应在 0 和医疗总费用之间。");
      return;
    }
    if (!selectedCase || !selectedBenefitIds.length) {
      flash("请至少选择一个本账单适用的保障责任。");
      return;
    }
    const response = await apiFetch("/api/automatic-calculation/bills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        claimCaseId: selectedCase.id,
        billData: { ...billForm, totalAmount, insuranceFundAmount, personalAccountAmount, cashAmount, selfPaidAmount },
        customValues: customBillValues,
        selectedBenefitIds,
      }),
    });
    const result = await response.json() as BillEntry & { message?: string };
    if (!response.ok) {
      flash(`账单保存失败：${result.message ?? "请检查录入内容"}`);
      return;
    }
    setBills((items) => [...items, result]);
    const insuredParty = selectedCase?.parties.find((party) => party.role === "insured");
    setBillForm(emptyBillForm(insuredParty?.name ?? "", insuredParty?.idNo ?? ""));
    setSelectedBenefitIds([]);
    setCustomBillValues(Object.fromEntries(automationVariables.filter((variable) => variable.category === "bill" && variable.custom).map((variable) => [variable.variableName, variable.defaultValue ?? ""])));
    flash("账单已录入，试算金额已更新。");
  }

  async function removeBill(id: string) {
    const response = await apiFetch(`/api/automatic-calculation/bills?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) {
      flash("账单删除失败，请稍后重试。");
      return;
    }
    setBills((items) => items.filter((bill) => bill.id !== id));
    setCalculationResult(null);
    if (selectedCase) setWorkflowByCase((current) => ({ ...current, [selectedCase.id]: "editing" }));
    flash("账单已删除，需要重新理算。");
  }

  function addEvent() {
    if (!eventForm.occurredDate || !eventForm.description.trim()) {
      flash("请填写事件发生日期和事件经过。");
      return;
    }
    setEvents((items) => [...items, { id: newId(), ...eventForm }]);
    setEventForm({ eventType: "disease", occurredDate: "", location: "", description: "" });
    flash("事件已录入。");
  }

  function addDisease() {
    if (!diseaseForm.diseaseName.trim() || !diseaseForm.diagnosisDate || !diseaseForm.hospital.trim()) {
      flash("请填写疾病名称、确诊日期和确诊医院。");
      return;
    }
    setDiseases((items) => [...items, { id: newId(), ...diseaseForm }]);
    setDiseaseForm({ diseaseName: "", icdCode: "", diagnosisDate: "", hospital: "", note: "" });
    flash("疾病已录入。");
  }

  async function runCalculation() {
    if (!selectedCase) return;
    if (!bills.length) {
      flash("请先录入至少一张账单，再进行理算。");
      setActiveTab("bill");
      return;
    }
    const response = await apiFetch("/api/automatic-calculation/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimCaseId: selectedCase.id, commit: false }),
    });
    const result = await response.json() as AutomaticCalculationResult & { message?: string };
    if (!response.ok) {
      flash(`自动理算失败：${result.message ?? "请检查责任公式和账单责任选择"}`);
      return;
    }
    setCalculationResult(result);
    setLedgerBalances(result.ledgerBalances);
    setWorkflowByCase((current) => ({ ...current, [selectedCase.id]: "calculated" }));
    flash(`自动理算完成，本次案件给付金额为 ¥ ${money(result.totalAmount)}。`);
  }

  async function submitCalculation() {
    if (!selectedCase) return;
    if (workflowStatus !== "calculated") {
      flash("请先完成理算，再提交理算结果。");
      return;
    }
    const calculationResponse = await apiFetch("/api/automatic-calculation/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimCaseId: selectedCase.id, commit: true }),
    });
    const committedResult = await calculationResponse.json() as AutomaticCalculationResult & { message?: string };
    if (!calculationResponse.ok) {
      flash(`理算结果落账失败：${committedResult.message ?? "请稍后重试"}`);
      return;
    }
    setCalculationResult(committedResult);
    setLedgerBalances(committedResult.ledgerBalances);
    const currentCase = selectedCase;
    const response = await apiFetch("/api/claim-registrations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ id: currentCase.id, action: "complete" }),
    });
    if (!response.ok) {
      flash("理算结果提交失败，案件状态可能已经变化。");
      return;
    }
    setProcessingCases((items) => items.filter((item) => item.id !== currentCase.id));
    setSelectedCase(null);
    flash(`案件 ${currentCase.caseNo} 已完成理算并结案。`);
  }

  async function withdrawCase() {
    if (!selectedCase) return;
    const currentCase = selectedCase;
    const response = await apiFetch("/api/claim-registrations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ id: currentCase.id, action: "cancel" }),
    });
    if (!response.ok) {
      flash("撤件失败，案件状态可能已经变化。");
      return;
    }
    setProcessingCases((items) => items.filter((item) => item.id !== currentCase.id));
    setSelectedCase(null);
    flash(`案件 ${currentCase.caseNo} 已撤件。`);
  }

  if (!selectedCase) {
    return (
      <div className="entry-calculation-page">
        <section className="panel entry-case-heading">
          <div>
            <div className="section-title">录入与理算</div>
            <p>请选择从“受理立案”提交上来的案件，再录入账单、事件和疾病信息。</p>
          </div>
          <button className="secondary-button" type="button" disabled={caseLoading} onClick={() => void loadProcessingCases()}>
            {caseLoading ? "刷新中…" : "刷新案件"}
          </button>
        </section>

        <section className="panel entry-case-list-panel">
          <div className="entry-case-list-tools">
            <div>
              <div className="section-title">待录入案件</div>
              <small className="muted">仅展示从受理立案提交后进入“处理中”的案件</small>
            </div>
            <label className="entry-case-search">
              <span>搜索案件</span>
              <input className="filter-control" value={caseKeyword} onChange={(event) => setCaseKeyword(event.target.value)} placeholder="案件号、保单号、被保人或证件号" />
            </label>
          </div>
          {caseError ? <p className="field-error">{caseError}</p> : null}
          <div className="table-wrapper entry-case-table">
            <table>
              <thead><tr><th>案件号</th><th>保单号</th><th>被保人</th><th>证件号</th><th>关联事件</th><th>报案日期</th><th>状态</th><th>提交时间</th><th>操作</th></tr></thead>
              <tbody>
                {caseLoading ? (
                  <tr><td className="config-empty-cell" colSpan={9}>正在加载处理中案件…</td></tr>
                ) : filteredCases.length ? filteredCases.map((item) => {
                  const insured = item.parties.find((party) => party.role === "insured");
                  return (
                    <tr key={item.id} onDoubleClick={() => openCase(item)}>
                      <td><strong>{item.caseNo}</strong></td>
                      <td>{item.policyNo}</td>
                      <td>{insured?.name ?? "-"}</td>
                      <td>{insured?.idNo ?? "-"}</td>
                      <td>{item.event.eventNo}</td>
                      <td>{item.reportDate}</td>
                      <td><span className="status-badge claim-processing">处理中</span></td>
                      <td>{new Date(item.updatedAt).toLocaleString("zh-CN", { hour12: false })}</td>
                      <td><button type="button" className="action-link" onClick={() => openCase(item)}>编辑</button></td>
                    </tr>
                  );
                }) : (
                  <tr><td className="config-empty-cell" colSpan={9}>{caseKeyword ? "没有找到匹配的处理中案件。" : "暂无处理中案件，请先在受理立案中提交案件。"}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  const insured = selectedCase.parties.find((party) => party.role === "insured");

  return (
    <div className={`claim-image-push-stage ${attachmentsOpen ? "image-open" : ""}`}>
      <ClaimImageWorkspace
        open={attachmentsOpen}
        caseNo={selectedCase.caseNo}
        attachments={selectedCase.attachments}
        busy={attachmentBusy}
        onClose={() => setAttachmentsOpen(false)}
        onUpload={(files) => void uploadCalculationAttachments(files)}
        onRemove={(uploadId) => void removeCalculationAttachment(uploadId)}
      />
      <div className="entry-calculation-page">
      {message && <div className="entry-feedback">{message}</div>}

      <section className="panel entry-page-header">
        <div>
          <div className="section-title">{selectedCase.caseNo} · {insured?.name ?? "未知被保人"}</div>
          <p>保单号 {selectedCase.policyNo} ｜ 关联事件 {selectedCase.event.eventNo} ｜ 报案日期 {selectedCase.reportDate}</p>
        </div>
        <div className="entry-header-actions">
          <button type="button" className="secondary-button" onClick={() => setAcceptanceEditOpen((open) => !open)}>{acceptanceEditOpen ? "返回理算" : "受理信息"}</button>
          <button type="button" className="secondary-button" onClick={runCalculation}>理算</button>
          <button type="button" onClick={() => void submitCalculation()}>提交</button>
          <button type="button" className="danger-button" onClick={() => void withdrawCase()}>撤件</button>
          <button className="page-back-button" type="button" onClick={() => setSelectedCase(null)}>返回上一页</button>
        </div>
      </section>

      {acceptanceEditOpen ? (
        <div className="entry-embedded-acceptance">
          <ClaimRegistrationPage
            embeddedCase={selectedCase}
            onCaseUpdated={(updated) => {
              setSelectedCase(updated);
              setProcessingCases((items) => items.map((item) => item.id === updated.id ? updated : item));
              flash("受理信息已更新，并同步到当前理算案件。");
            }}
          />
        </div>
      ) : <>
      <section className="panel entry-summary-panel">
        <div className="entry-summary">
          <div><span>处理状态</span><strong>{workflowStatus === "calculated" ? "已理算" : "录入中"}</strong></div>
          <div><span>账单数</span><strong>{bills.length}</strong></div>
          <div><span>费用合计</span><strong>¥ {money(totals.total)}</strong></div>
          <div><span>自费合计</span><strong>¥ {money(totals.selfPaid)}</strong></div>
          <div className="entry-summary-primary"><span>自动理算金额</span><strong>¥ {money(calculationResult?.totalAmount ?? totals.eligible)}</strong></div>
        </div>
      </section>

      {calculationResult ? (
        <section className="panel automatic-result-panel">
          <div className="panel-title-row"><div><div className="section-title">案件自动理算结果</div><small className="muted">运行号 {calculationResult.runNo} ｜ {calculationResult.committed ? "已落账" : "试算，尚未落账"}</small></div><strong className="automatic-result-total">¥ {money(calculationResult.totalAmount)}</strong></div>
          <div className="table-wrapper automatic-result-table"><table><thead><tr><th>票据号码</th><th>保障责任</th><th>执行公式</th><th>步骤数</th><th>给付金额</th></tr></thead><tbody>
            {calculationResult.billResults.map((item, index) => <tr key={`${item.billId}-${item.benefitId}-${index}`}><td>{item.invoiceNo}</td><td>{item.benefitName}<small className="table-description">{item.benefitCode}</small></td><td>{item.formulaName}</td><td>{item.steps.length}</td><td className="entry-amount">¥ {money(item.amount)}</td></tr>)}
          </tbody></table></div>
        </section>
      ) : null}

      {ledgerBalances.length ? (
        <section className="panel automatic-ledger-panel">
          <div className="panel-title-row"><div><div className="section-title">人员责任年度台账</div><small className="muted">打开案件时已自动带入历史案件累计值；本案试算后显示预计结余，提交后正式落账</small></div><span className="muted">{ledgerBalances.length} 项</span></div>
          <div className="automatic-ledger-grid">
            {ledgerBalances.map((ledger) => <div key={`${ledger.benefitId}-${ledger.ledgerCode}`}><span>{automationBenefits.find((benefit) => benefit.id === ledger.benefitId)?.name ?? "责任"} · {ledger.ledgerName}</span><strong>已使用 ¥ {money(ledger.usedAmount)}</strong><small>{ledger.configuredAmount === undefined ? `${ledger.periodYear} 年度累计（已带入历史案件）` : `配置 ¥ ${money(ledger.configuredAmount)} ｜ 剩余 ¥ ${money(ledger.remainingAmount ?? 0)}`}</small></div>)}
          </div>
        </section>
      ) : null}

      <div className="entry-layout">
        <aside className="panel entry-side-tabs">
          <button className={activeTab === "bill" ? "active" : ""} onClick={() => setActiveTab("bill")}>
            <span>01</span><div><strong>账单录入</strong><small>{bills.length} 条账单</small></div>
          </button>
          <button className={activeTab === "event" ? "active" : ""} onClick={() => setActiveTab("event")}>
            <span>02</span><div><strong>事件录入</strong><small>{events.length} 条事件</small></div>
          </button>
          <button className={activeTab === "disease" ? "active" : ""} onClick={() => setActiveTab("disease")}>
            <span>03</span><div><strong>疾病录入</strong><small>{diseases.length} 条疾病</small></div>
          </button>
          <button className={attachmentsOpen ? "active" : ""} onClick={() => setAttachmentsOpen((open) => !open)}>
            <span>04</span><div><strong>影像件</strong><small>{selectedCase.attachments.length} 件资料</small></div>
          </button>
        </aside>

        <div className="entry-main">
          {activeTab === "bill" && (
            <>
              <section className="panel">
                <div className="section-title">录入账单</div>
                <div className="entry-form-grid">
                  <div className="entry-form-section-title">票据信息</div>
                  <label><span>票据代码</span><input value={billForm.invoiceCode} onChange={(event) => setBillForm({ ...billForm, invoiceCode: event.target.value })} placeholder="电子票据代码" /></label>
                  <label><span>票据号码 <b>*</b></span><input value={billForm.invoiceNo} onChange={(event) => setBillForm({ ...billForm, invoiceNo: event.target.value })} placeholder="请输入票据号码" /></label>
                  <label><span>校验码</span><input value={billForm.checkCode} onChange={(event) => setBillForm({ ...billForm, checkCode: event.target.value })} placeholder="票据校验码" /></label>
                  <label><span>票据类型</span><AppSelect ariaLabel="票据类型" value={billForm.billType} options={billTypeOptions} onChange={(billType) => setBillForm({ ...billForm, billType })} /></label>

                  <div className="entry-form-section-title">患者与就诊信息</div>
                  <label><span>患者姓名 <b>*</b></span><input value={billForm.patientName} onChange={(event) => setBillForm({ ...billForm, patientName: event.target.value })} /></label>
                  <label><span>患者证件号码</span><input value={billForm.patientIdNo} onChange={(event) => setBillForm({ ...billForm, patientIdNo: event.target.value.toUpperCase() })} /></label>
                  <label><span>门诊 / 住院号</span><input value={billForm.visitNo} onChange={(event) => setBillForm({ ...billForm, visitNo: event.target.value })} /></label>
                  <label><span>医疗机构 <b>*</b></span><input value={billForm.institution} onChange={(event) => setBillForm({ ...billForm, institution: event.target.value })} placeholder="请输入医院或药店名称" /></label>
                  <label><span>就诊科室</span><input value={billForm.department} onChange={(event) => setBillForm({ ...billForm, department: event.target.value })} /></label>
                  <label><span>收费日期 <b>*</b></span><AppDatePicker ariaLabel="收费日期" value={billForm.billDate} onChange={(billDate) => setBillForm({ ...billForm, billDate })} /></label>
                  <label><span>入院日期</span><AppDatePicker ariaLabel="入院日期" value={billForm.admissionDate} onChange={(admissionDate) => setBillForm({ ...billForm, admissionDate })} /></label>
                  <label><span>出院日期</span><AppDatePicker ariaLabel="出院日期" value={billForm.dischargeDate} onChange={(dischargeDate) => setBillForm({ ...billForm, dischargeDate })} /></label>
                  <label className="entry-wide"><span>主要诊断</span><input value={billForm.diagnosis} onChange={(event) => setBillForm({ ...billForm, diagnosis: event.target.value })} placeholder="疾病或诊断名称" /></label>
                  <label><span>收费员</span><input value={billForm.cashier} onChange={(event) => setBillForm({ ...billForm, cashier: event.target.value })} /></label>

                  <div className="entry-form-section-title">医保结算信息</div>
                  <label className="entry-wide"><span>医保类型</span><AppSelect ariaLabel="医保类型" value={billForm.medicalInsuranceType} options={medicalInsuranceTypeOptions} onChange={(medicalInsuranceType) => setBillForm({ ...billForm, medicalInsuranceType })} /></label>
                  <label className="entry-wide"><span>医保结算单号</span><input value={billForm.settlementNo} onChange={(event) => setBillForm({ ...billForm, settlementNo: event.target.value })} /></label>

                  <div className="entry-form-section-title">费用与支付信息</div>
                  <label><span>医疗总费用（元）<b>*</b></span><input type="number" min="0" step="0.01" value={billForm.totalAmount} onChange={(event) => setBillForm({ ...billForm, totalAmount: event.target.value })} placeholder="0.00" /></label>
                  <label><span>医保统筹支付（元）</span><input type="number" min="0" step="0.01" value={billForm.insuranceFundAmount} onChange={(event) => setBillForm({ ...billForm, insuranceFundAmount: event.target.value })} placeholder="0.00" /></label>
                  <label><span>个人账户支付（元）</span><input type="number" min="0" step="0.01" value={billForm.personalAccountAmount} onChange={(event) => setBillForm({ ...billForm, personalAccountAmount: event.target.value })} placeholder="0.00" /></label>
                  <label><span>个人现金支付（元）</span><input type="number" min="0" step="0.01" value={billForm.cashAmount} onChange={(event) => setBillForm({ ...billForm, cashAmount: event.target.value })} placeholder="0.00" /></label>
                  <label><span>其中自费（元）</span><input type="number" min="0" step="0.01" value={billForm.selfPaidAmount} onChange={(event) => setBillForm({ ...billForm, selfPaidAmount: event.target.value })} placeholder="0.00" /></label>
                  {customBillVariables.length ? <>
                    <div className="entry-form-section-title">保单自定义账单参数</div>
                    {customBillVariables.map((variable) => <label key={variable.id ?? variable.variableName}><span>{variable.variableName}{variable.unit ? `（${variable.unit}）` : ""}</span><input type={["amount", "number", "percentage"].includes(variable.valueType) ? "number" : "text"} value={customBillValues[variable.variableName] ?? ""} onChange={(event) => setCustomBillValues((current) => ({ ...current, [variable.variableName]: event.target.value }))} placeholder={variable.description ?? variable.defaultValue ?? ""} /></label>)}
                  </> : null}
                  <div className="entry-form-section-title">本账单适用责任 <b>*</b></div>
                  <div className="entry-benefit-selector entry-full">
                    {automationBenefits.map((benefit) => {
                      const formula = automationFormulas.find((item) => item.benefitId === benefit.id);
                      const checked = selectedBenefitIds.includes(benefit.id);
                      return <label key={benefit.id} className={checked ? "selected" : ""}><input type="checkbox" checked={checked} disabled={!formula?.steps.length || !formula.enabled} onChange={(event) => setSelectedBenefitIds((current) => event.target.checked ? [...current, benefit.id] : current.filter((id) => id !== benefit.id))} /><span><strong>{benefit.name}</strong><small>{benefit.productName} ｜ {formula?.steps.length ? `${formula.steps.length} 步公式` : "尚未配置公式"}</small></span></label>;
                    })}
                  </div>
                </div>
                <div className="entry-form-actions"><button type="button" onClick={() => void addBill()}>保存账单</button></div>
              </section>
              <section className="panel entry-list-panel">
                <div className="panel-title-row"><div className="section-title">已录入账单</div><span className="muted">共 {bills.length} 条</span></div>
                <div className="table-wrapper">
                  <table className="entry-medical-bill-table"><thead><tr><th>票据号码</th><th>患者</th><th>适用责任</th><th>票据类型</th><th>医疗机构 / 科室</th><th>收费日期</th><th>医保类型</th><th>医疗总费用</th><th>统筹支付</th><th>个人账户</th><th>现金支付</th><th>自费金额</th><th>自动理算基数</th><th>操作</th></tr></thead>
                    <tbody>{bills.length ? bills.map((item) => <tr key={item.id}><td><strong>{item.invoiceNo}</strong><small className="table-description">{item.invoiceCode || item.checkCode ? `${item.invoiceCode || "-"} ｜ ${item.checkCode || "-"}` : ""}</small></td><td>{item.patientName}<small className="table-description">{item.visitNo || item.patientIdNo}</small></td><td>{item.selectedBenefitIds.map((id) => automationBenefits.find((benefit) => benefit.id === id)?.name).filter(Boolean).join("、") || "-"}</td><td>{billTypeOptions.find((option) => option.value === item.billType)?.label}</td><td>{item.institution}<small className="table-description">{item.department || item.diagnosis}</small></td><td>{item.billDate}</td><td>{medicalInsuranceTypeOptions.find((option) => option.value === item.medicalInsuranceType)?.label}</td><td>¥ {money(item.totalAmount)}</td><td>¥ {money(item.insuranceFundAmount)}</td><td>¥ {money(item.personalAccountAmount)}</td><td>¥ {money(item.cashAmount)}</td><td>¥ {money(item.selfPaidAmount)}</td><td className="entry-amount">¥ {money(item.totalAmount - item.selfPaidAmount)}</td><td><button className="danger-link" onClick={() => void removeBill(item.id)}>删除</button></td></tr>) : <tr><td className="config-empty-cell" colSpan={14}>暂无账单，请先在上方录入。</td></tr>}</tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {activeTab === "event" && (
            <>
              <section className="panel">
                <div className="section-title">录入事件</div>
                <div className="entry-form-grid">
                  <label><span>事件类型</span><AppSelect ariaLabel="事件类型" value={eventForm.eventType} options={eventTypeOptions} onChange={(eventType) => setEventForm({ ...eventForm, eventType })} /></label>
                  <label><span>发生日期 <b>*</b></span><AppDatePicker ariaLabel="事件发生日期" value={eventForm.occurredDate} onChange={(occurredDate) => setEventForm({ ...eventForm, occurredDate })} /></label>
                  <label className="entry-wide"><span>发生地点</span><input value={eventForm.location} onChange={(event) => setEventForm({ ...eventForm, location: event.target.value })} placeholder="请输入发生地点" /></label>
                  <label className="entry-full"><span>事件经过 <b>*</b></span><textarea value={eventForm.description} onChange={(event) => setEventForm({ ...eventForm, description: event.target.value })} placeholder="请描述事件发生经过" /></label>
                </div>
                <div className="entry-form-actions"><button type="button" onClick={addEvent}>添加事件</button></div>
              </section>
              <section className="panel entry-list-panel">
                <div className="panel-title-row"><div className="section-title">已录入事件</div><span className="muted">共 {events.length} 条</span></div>
                <div className="table-wrapper"><table><thead><tr><th>事件类型</th><th>发生日期</th><th>发生地点</th><th>事件经过</th><th>操作</th></tr></thead><tbody>{events.length ? events.map((item) => <tr key={item.id}><td>{eventTypeOptions.find((option) => option.value === item.eventType)?.label}</td><td>{item.occurredDate}</td><td>{item.location || "-"}</td><td>{item.description}</td><td><button className="danger-link" onClick={() => setEvents((items) => items.filter((entry) => entry.id !== item.id))}>删除</button></td></tr>) : <tr><td className="config-empty-cell" colSpan={5}>暂无事件，请先在上方录入。</td></tr>}</tbody></table></div>
              </section>
            </>
          )}

          {activeTab === "disease" && (
            <>
              <section className="panel">
                <div className="section-title">录入疾病</div>
                <div className="entry-form-grid">
                  <label><span>疾病名称 <b>*</b></span><input value={diseaseForm.diseaseName} onChange={(event) => setDiseaseForm({ ...diseaseForm, diseaseName: event.target.value })} placeholder="请输入疾病或诊断名称" /></label>
                  <label><span>ICD 编码</span><input value={diseaseForm.icdCode} onChange={(event) => setDiseaseForm({ ...diseaseForm, icdCode: event.target.value.toUpperCase() })} placeholder="例如 J18.9" /></label>
                  <label><span>确诊日期 <b>*</b></span><AppDatePicker ariaLabel="确诊日期" value={diseaseForm.diagnosisDate} onChange={(diagnosisDate) => setDiseaseForm({ ...diseaseForm, diagnosisDate })} /></label>
                  <label><span>确诊医院 <b>*</b></span><input value={diseaseForm.hospital} onChange={(event) => setDiseaseForm({ ...diseaseForm, hospital: event.target.value })} placeholder="请输入确诊医院" /></label>
                  <label className="entry-full"><span>诊断说明</span><textarea value={diseaseForm.note} onChange={(event) => setDiseaseForm({ ...diseaseForm, note: event.target.value })} placeholder="可补充症状、检查结果或诊断说明" /></label>
                </div>
                <div className="entry-form-actions"><button type="button" onClick={addDisease}>添加疾病</button></div>
              </section>
              <section className="panel entry-list-panel">
                <div className="panel-title-row"><div className="section-title">已录入疾病</div><span className="muted">共 {diseases.length} 条</span></div>
                <div className="table-wrapper"><table><thead><tr><th>疾病名称</th><th>ICD 编码</th><th>确诊日期</th><th>确诊医院</th><th>诊断说明</th><th>操作</th></tr></thead><tbody>{diseases.length ? diseases.map((item) => <tr key={item.id}><td>{item.diseaseName}</td><td>{item.icdCode || "-"}</td><td>{item.diagnosisDate}</td><td>{item.hospital}</td><td>{item.note || "-"}</td><td><button className="danger-link" onClick={() => setDiseases((items) => items.filter((disease) => disease.id !== item.id))}>删除</button></td></tr>) : <tr><td className="config-empty-cell" colSpan={6}>暂无疾病，请先在上方录入。</td></tr>}</tbody></table></div>
              </section>
            </>
          )}
        </div>
      </div>
      </>}

      </div>
    </div>
  );
}
