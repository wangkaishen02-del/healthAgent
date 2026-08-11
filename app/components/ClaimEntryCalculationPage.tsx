"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { RegisteredPageController } from "../../src/assistant/page-controller";
import type { ClaimCase, ClaimPersonEvent, ClaimUpload } from "../../src/claims/types";
import { apiFetch } from "../../src/api/client";
import AppCombobox from "./AppCombobox";
import AppDatePicker from "./AppDatePicker";
import AppSelect, { type AppSelectOption } from "./AppSelect";
import ClaimRegistrationPage from "./ClaimRegistrationPage";
import ClaimImageWorkspace from "./ClaimImageWorkspace";
import ClaimWorkflowDialogs from "./ClaimWorkflowDialogs";
import type { AutomaticCalculationResult, BenefitFormulaView, CalculationVariableView, LedgerBalanceView } from "../../src/calculation/automation-types";
import {
  acceptanceReviewSections,
  adaptiveCasePageSize,
  billTypeOptions,
  DEFAULT_CASE_PAGE_SIZE,
  detailStatusLabels,
  emptyBillForm,
  emptyCalculationEventForm,
  eventAreaOptions,
  eventFilterOptions,
  eventTypeOptions,
  medicalInsuranceTypeOptions,
  money,
  type AutomationBenefit,
  type BillAttachmentChangeDecision,
  type BillEntry,
  type CalculationDictionaryItem,
  type CaseEntryData,
  type ClaimEntryCalculationPageProps,
  type DiseaseEntry,
  type EntryTab,
  type EntryWorkflowStatus,
  type ProcessingCaseResult,
} from "./ClaimEntryCalculationModel";

const ClaimEntryCalculationPage = forwardRef<RegisteredPageController, ClaimEntryCalculationPageProps>(function ClaimEntryCalculationPage({ mode = "processing", initialCase, onClose }, assistantRef) {
  const reviewMode = mode === "review";
  const queryMode = mode === "query";
  const readOnlyMode = reviewMode || queryMode;
  const [activeTab, setActiveTab] = useState<EntryTab>("bill");
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [processingCases, setProcessingCases] = useState<ClaimCase[]>([]);
  const [selectedCase, setSelectedCase] = useState<ClaimCase | null>(initialCase ?? null);
  const [caseKeyword, setCaseKeyword] = useState("");
  const [casePage, setCasePage] = useState(1);
  const [casePageSize, setCasePageSize] = useState(DEFAULT_CASE_PAGE_SIZE);
  const [caseTotal, setCaseTotal] = useState(0);
  const [caseLoading, setCaseLoading] = useState(true);
  const [caseError, setCaseError] = useState("");
  const [entriesByCase, setEntriesByCase] = useState<Record<string, CaseEntryData>>({});
  const [workflowByCase, setWorkflowByCase] = useState<Record<string, EntryWorkflowStatus>>({});
  const [automationBenefits, setAutomationBenefits] = useState<AutomationBenefit[]>([]);
  const [automationFormulas, setAutomationFormulas] = useState<BenefitFormulaView[]>([]);
  const [automationVariables, setAutomationVariables] = useState<CalculationVariableView[]>([]);
  const [automationDictionaries, setAutomationDictionaries] = useState<CalculationDictionaryItem[]>([]);
  const [currentAttachmentId, setCurrentAttachmentId] = useState("");
  const [bindBillCurrentImage, setBindBillCurrentImage] = useState(false);
  const [editingBillId, setEditingBillId] = useState("");
  const [editingEventId, setEditingEventId] = useState("");
  const [editingDiseaseId, setEditingDiseaseId] = useState("");
  const [billFormOpen, setBillFormOpen] = useState(false);
  const [eventFormOpen, setEventFormOpen] = useState(false);
  const [diseaseFormOpen, setDiseaseFormOpen] = useState(false);
  const [customBillValues, setCustomBillValues] = useState<Record<string, string>>({});
  const [ledgerBalances, setLedgerBalances] = useState<LedgerBalanceView[]>([]);
  const [calculationResult, setCalculationResult] = useState<AutomaticCalculationResult | null>(null);
  const [calculationProcessOpen, setCalculationProcessOpen] = useState(false);
  const [ledgerDrawerOpen, setLedgerDrawerOpen] = useState(false);
  const [selectedProcessBillId, setSelectedProcessBillId] = useState("");
  const [selectedProcessBenefitId, setSelectedProcessBenefitId] = useState("");
  const [rollbackPromptOpen, setRollbackPromptOpen] = useState(false);
  const [caseRollbackPromptOpen, setCaseRollbackPromptOpen] = useState(false);
  const [withdrawPromptOpen, setWithdrawPromptOpen] = useState(false);
  const [attachmentChangePrompt, setAttachmentChangePrompt] = useState<{ previousName: string; nextName?: string } | null>(null);
  const [billForm, setBillForm] = useState(() => emptyBillForm());
  const [eventForm, setEventForm] = useState(() => emptyCalculationEventForm());
  const [eventKeyword, setEventKeyword] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState("all");
  const [eventDateFilter, setEventDateFilter] = useState("");
  const [diseaseForm, setDiseaseForm] = useState({
    diseaseName: "",
    icdCode: "",
    diagnosisDate: "",
    hospital: "",
    note: "",
  });
  const billFormSectionRef = useRef<HTMLElement | null>(null);
  const eventFormSectionRef = useRef<HTMLElement | null>(null);
  const diseaseFormSectionRef = useRef<HTMLElement | null>(null);
  const casePageSizeRef = useRef(DEFAULT_CASE_PAGE_SIZE);
  const attachmentChangeResolverRef = useRef<((decision: BillAttachmentChangeDecision) => void) | null>(null);
  const assistantStateRef = useRef({
    processingCases,
    selectedCase,
    caseKeyword,
    bills: [] as BillEntry[],
    events: [] as ClaimPersonEvent[],
    diseases: [] as DiseaseEntry[],
    billForm,
    eventForm,
    diseaseForm,
    calculationResult,
    rollbackPromptOpen,
    caseRollbackPromptOpen,
    withdrawPromptOpen,
  });

  const currentEntries = selectedCase ? entriesByCase[selectedCase.id] : undefined;
  const bills = currentEntries?.bills ?? [];
  const events = currentEntries?.events ?? [];
  const diseases = currentEntries?.diseases ?? [];
  assistantStateRef.current = {
    processingCases,
    selectedCase,
    caseKeyword,
    bills,
    events,
    diseases,
    billForm,
    eventForm,
    diseaseForm,
    calculationResult,
    rollbackPromptOpen,
    caseRollbackPromptOpen,
    withdrawPromptOpen,
  };
  const customBillVariables = automationVariables.filter((variable) => variable.category === "bill" && variable.custom && variable.enabled);
  const dictionaryOptions = (dictionaryType: string, fallback: AppSelectOption<string>[]) => {
    const items = automationDictionaries.filter((item) => item.dictionaryType === dictionaryType);
    return items.length ? items.map((item) => ({ value: item.itemCode, label: item.itemName })) : fallback;
  };
  const activeBillTypeOptions = dictionaryOptions("bill_type", billTypeOptions);
  const activeMedicalInsuranceTypeOptions = dictionaryOptions("medical_insurance_type", medicalInsuranceTypeOptions);
  const activeEventTypeOptions = dictionaryOptions("event_type", eventTypeOptions);
  const filteredEvents = useMemo(() => events
    .filter((item) => eventTypeFilter === "all" || item.eventType === eventTypeFilter)
    .filter((item) => !eventDateFilter || item.occurredDate === eventDateFilter)
    .filter((item) => {
      const keyword = eventKeyword.trim().toLowerCase();
      return !keyword || [
        item.eventNo,
        item.administrativeArea,
        item.detailedAddress,
        item.hospitalName,
        item.diagnosis,
        item.description,
      ].some((value) => value?.toLowerCase().includes(keyword));
    }), [events, eventDateFilter, eventKeyword, eventTypeFilter]);
  const workflowStatus = selectedCase ? workflowByCase[selectedCase.id] ?? "editing" : "editing";
  const hasCalculationResult = Boolean(calculationResult);
  const calculationIsCurrent = hasCalculationResult;
  const calculationDataLocked = readOnlyMode || hasCalculationResult || selectedCase?.status === "calculating";
  const caseTotalPages = Math.max(1, Math.ceil(caseTotal / casePageSize));

  const totals = useMemo(() => {
    const total = bills.reduce((sum, item) => sum + item.totalAmount, 0);
    const selfPaid = bills.reduce((sum, item) => sum + item.selfPaidAmount, 0);
    return { total, selfPaid, eligible: Math.max(0, total - selfPaid) };
  }, [bills]);
  const processBills = useMemo(() => {
    if (!calculationResult) return [];
    return [...new Map(calculationResult.billResults.map((item) => [
      item.billId,
      (() => {
        const bill = bills.find((entry) => entry.id === item.billId);
        return {
        id: item.billId,
        invoiceNo: item.invoiceNo || "未填写票据号",
        billType: activeBillTypeOptions.find((option) => option.value === bill?.billType)?.label ?? "-",
        institution: bill?.institution || "-",
        billDate: bill?.billDate || "-",
        totalAmount: bill?.totalAmount ?? 0,
        calculationAmount: calculationResult.billResults
          .filter((result) => result.billId === item.billId && result.matched !== false)
          .reduce((sum, result) => sum + result.amount, 0),
        matchedBenefitCount: calculationResult.billResults.filter((result) => result.billId === item.billId && result.matched !== false).length,
        };
      })(),
    ])).values()];
  }, [activeBillTypeOptions, bills, calculationResult]);
  const processBenefitResults = useMemo(() => {
    if (!calculationResult || !selectedProcessBillId) return [];
    return calculationResult.billResults
      .filter((item) => item.billId === selectedProcessBillId && item.matched !== false);
  }, [calculationResult, selectedProcessBillId]);
  const selectedProcessResult = useMemo(() => calculationResult?.billResults.find(
    (item) => item.billId === selectedProcessBillId && item.benefitId === selectedProcessBenefitId && item.matched !== false,
  ) ?? null, [calculationResult, selectedProcessBillId, selectedProcessBenefitId]);
  const ledgerGroups = useMemo(() => {
    const definitions = [
      { key: "benefit", title: "责任台账", description: "按具体保障责任累计免赔额和给付金额" },
      { key: "product", title: "险种台账", description: "按险种汇总其下责任产生的累计值" },
      { key: "plan", title: "保障计划台账", description: "按被保险人所属保障计划汇总" },
      { key: "event", title: "事件台账", description: "按本次理赔事件汇总累计值" },
    ] as const;
    return definitions.map((definition) => {
      const scoped = ledgerBalances.filter((ledger) => definition.key === "benefit"
        ? !ledger.benefitId.includes(":")
        : ledger.benefitId.startsWith(`${definition.key}:`));
      const targets = [...new Set(scoped.map((ledger) => ledger.benefitId))].map((targetId) => {
        const rawTargetId = targetId.includes(":") ? targetId.slice(targetId.indexOf(":") + 1) : targetId;
        const targetName = definition.key === "benefit"
          ? automationBenefits.find((benefit) => benefit.id === rawTargetId)?.name ?? "保障责任"
          : definition.key === "product"
            ? automationBenefits.find((benefit) => benefit.productId === rawTargetId)?.productName ?? "险种"
            : definition.key === "plan"
              ? `保障计划 · ${[...new Set(automationBenefits.filter((benefit) => benefit.planId === rawTargetId).map((benefit) => benefit.productName))].join("、") || "未命名"}`
              : `理赔事件 ${selectedCase?.event.eventNo ?? ""}`.trim();
        return {
          id: targetId,
          name: targetName,
          items: scoped
            .filter((ledger) => ledger.benefitId === targetId)
            .sort((a, b) => {
              const order = (code: string) => code === "annual_deductible" ? 0 : code === "annual_payment" ? 1 : 2;
              return order(a.ledgerCode) - order(b.ledgerCode) || a.ledgerName.localeCompare(b.ledgerName, "zh-CN");
            }),
        };
      });
      return { ...definition, targets, itemCount: scoped.length };
    }).filter((group) => group.targets.length);
  }, [automationBenefits, ledgerBalances, selectedCase?.event.eventNo]);

  async function loadProcessingCases(page = casePage, keyword = caseKeyword) {
    setCaseLoading(true);
    setCaseError("");
    try {
      let result: ProcessingCaseResult | null = null;
      for (let attempt = 0; attempt < 2 && !result; attempt += 1) {
        try {
          const params = new URLSearchParams({
            status: reviewMode ? "reviewing" : "entering,calculating",
            page: String(page),
            pageSize: String(casePageSize),
          });
          if (keyword.trim()) params.set("keyword", keyword.trim());
          const response = await apiFetch(`/api/claim-registrations?${params.toString()}`, { cache: "no-store" });
          if (!response.ok) throw new Error("processing_cases_failed");
          result = await response.json() as ProcessingCaseResult;
        } catch (error) {
          if (attempt === 1) throw error;
          await new Promise((resolve) => window.setTimeout(resolve, 300));
        }
      }
      if (!result) throw new Error("processing_cases_failed");
      setCaseTotal(result.total);
      const availablePages = Math.max(1, Math.ceil(result.total / casePageSize));
      if (page > availablePages) {
        setCasePage(availablePages);
        return result;
      }
      setProcessingCases(result.items);
      if (result.page !== casePage) setCasePage(result.page);
      if (selectedCase) {
        const refreshed = result.items.find((item) => item.id === selectedCase.id);
        setSelectedCase(refreshed ?? null);
      }
      return result;
    } catch {
      setCaseError(reviewMode ? "审核案件加载失败，请稍后重试。" : "录入、理算案件加载失败，请稍后重试。");
      return null;
    } finally {
      setCaseLoading(false);
    }
  }

  useEffect(() => {
    if (queryMode) return;
    const timer = window.setTimeout(() => { void loadProcessingCases(casePage, caseKeyword); }, caseKeyword.trim() ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [queryMode, reviewMode, casePage, caseKeyword, casePageSize]);

  useEffect(() => {
    let resizeTimer = 0;
    const updatePageSize = () => {
      const nextPageSize = adaptiveCasePageSize(window.innerHeight);
      if (casePageSizeRef.current === nextPageSize) return;
      casePageSizeRef.current = nextPageSize;
      setCasePageSize(nextPageSize);
      setCasePage(1);
    };
    const handleResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(updatePageSize, 120);
    };
    updatePageSize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.clearTimeout(resizeTimer);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    if (queryMode) return;
    const refresh = () => { void loadProcessingCases(casePage, caseKeyword); };
    window.addEventListener("claim-case-status-changed", refresh);
    return () => window.removeEventListener("claim-case-status-changed", refresh);
  }, [queryMode, reviewMode, casePage, caseKeyword, casePageSize]);

  useEffect(() => {
    if (queryMode && initialCase) openCase(initialCase);
  }, [queryMode, initialCase?.id]);

  useEffect(() => {
    if (billFormOpen) billFormSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [billFormOpen]);

  useEffect(() => {
    if (eventFormOpen) eventFormSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [eventFormOpen]);

  useEffect(() => {
    if (diseaseFormOpen) diseaseFormSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [diseaseFormOpen]);

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

  function setEvents(update: (items: ClaimPersonEvent[]) => ClaimPersonEvent[]) {
    updateCaseEntries("events", update);
  }

  function setDiseases(update: (items: DiseaseEntry[]) => DiseaseEntry[]) {
    updateCaseEntries("diseases", update);
  }

  function requestAttachmentChangeDecision(previousName: string, nextName?: string) {
    return new Promise<BillAttachmentChangeDecision>((resolve) => {
      attachmentChangeResolverRef.current = resolve;
      setAttachmentChangePrompt({ previousName, nextName });
    });
  }

  function resolveAttachmentChangeDecision(decision: BillAttachmentChangeDecision) {
    const resolve = attachmentChangeResolverRef.current;
    attachmentChangeResolverRef.current = null;
    setAttachmentChangePrompt(null);
    resolve?.(decision);
  }

  function openCase(item: ClaimCase) {
    const insuredParty = item.parties.find((party) => party.role === "insured");
    setSelectedCase(item);
    setActiveTab(readOnlyMode ? "acceptance_basic" : "bill");
    setAttachmentsOpen(false);
    setBillForm(emptyBillForm(insuredParty?.name ?? "", insuredParty?.idNo ?? ""));
    setEventForm({
      eventType: item.event.eventType,
      occurredDate: item.event.occurredDate,
      administrativeArea: item.event.administrativeArea ?? "",
      detailedAddress: item.event.detailedAddress ?? "",
      hospitalName: item.event.hospitalName ?? "",
      diagnosis: item.event.diagnosis ?? "",
      description: item.event.description,
    });
    setEventKeyword("");
    setEventTypeFilter("all");
    setEventDateFilter("");
    setDiseaseForm({ diseaseName: item.event.diagnosis ?? "", icdCode: "", diagnosisDate: item.event.occurredDate, hospital: item.event.hospitalName ?? "", note: "" });
    setCurrentAttachmentId(item.attachments[0]?.uploadId ?? "");
    setBindBillCurrentImage(false);
    setEditingBillId("");
    setEditingEventId("");
    setEditingDiseaseId("");
    setBillFormOpen(false);
    setEventFormOpen(false);
    setDiseaseFormOpen(false);
    setCustomBillValues({});
    setCalculationResult(null);
    setCalculationProcessOpen(false);
    setLedgerDrawerOpen(false);
    setRollbackPromptOpen(false);
    setCaseRollbackPromptOpen(false);
    setWithdrawPromptOpen(false);
    void loadCaseAutomation(item);
  }

  async function loadCaseAutomation(item: ClaimCase) {
    const [response, personEventsResponse] = await Promise.all([
      apiFetch(`/api/automatic-calculation?policyId=${encodeURIComponent(item.policyId)}&claimCaseId=${encodeURIComponent(item.id)}`, { cache: "no-store" }),
      apiFetch(`/api/claim-events?insuredPersonId=${encodeURIComponent(item.insuredPersonId)}`, { cache: "no-store" }),
    ]);
    if (!response.ok) {
      flash("自动理算配置加载失败，请稍后重试。");
      return;
    }
    const data = await response.json() as {
      benefits: AutomationBenefit[];
      formulas: BenefitFormulaView[];
      variables: CalculationVariableView[];
      dictionaries: CalculationDictionaryItem[];
      bills: BillEntry[];
      diseases: DiseaseEntry[];
      ledgerBalances: LedgerBalanceView[];
      latestResult: AutomaticCalculationResult | null;
    };
    const personEventsResult = personEventsResponse.ok
      ? await personEventsResponse.json() as { items: ClaimPersonEvent[] }
      : { items: [] };
    const personEvents = personEventsResult.items.some((event) => event.id === item.eventId)
      ? personEventsResult.items
      : [item.event, ...personEventsResult.items];
    setAutomationBenefits(data.benefits);
    setAutomationFormulas(data.formulas);
    setAutomationVariables(data.variables);
    setAutomationDictionaries(data.dictionaries ?? []);
    setLedgerBalances(data.ledgerBalances);
    if (data.latestResult?.claimCaseId === item.id) {
      setCalculationResult(data.latestResult);
      if (data.latestResult.committed) {
        setWorkflowByCase((current) => ({ ...current, [item.id]: "calculated" }));
      }
    }
    setEntriesByCase((current) => ({
      ...current,
      [item.id]: {
        bills: data.bills,
        events: personEvents,
        diseases: data.diseases ?? [],
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
    if (!selectedCase || !files?.length || calculationDataLocked) return;
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
    if (!selectedCase || calculationDataLocked) return;
    setAttachmentBusy(true);
    try {
      const updatedBills = await Promise.all(bills.filter((bill) => bill.attachmentIds?.includes(uploadId)).map(async (bill) => {
        const billData: Record<string, unknown> = {
          ...bill,
          attachmentIds: bill.attachmentIds.filter((item) => item !== uploadId),
        };
        ["id", "claimCaseId", "customValues", "selectedBenefitIds", "createdAt", "updatedAt"].forEach(
          (key) => delete billData[key],
        );
        const response = await apiFetch("/api/automatic-calculation/bills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: bill.id,
            claimCaseId: bill.claimCaseId,
            billData,
            customValues: bill.customValues,
            selectedBenefitIds: bill.selectedBenefitIds,
          }),
        });
        if (!response.ok) throw new Error("bill_attachment_unbind_failed");
        return response.json() as Promise<BillEntry>;
      }));
      const deleteResponse = await apiFetch(`/api/claim-attachments?uploadId=${encodeURIComponent(uploadId)}`, {
        method: "DELETE",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      if (!deleteResponse.ok) throw new Error("attachment_delete_failed");
      await saveCaseAttachments(selectedCase, selectedCase.attachments.filter((item) => item.uploadId !== uploadId));
      if (updatedBills.length) setBills((items) => items.map((bill) => updatedBills.find((updated) => updated.id === bill.id) ?? bill));
      if (currentAttachmentId === uploadId) setCurrentAttachmentId("");
      flash("影像件已删除。");
    } catch {
      flash("影像件删除失败，请稍后重试。");
    } finally {
      setAttachmentBusy(false);
    }
  }

  async function addBill() {
    if (calculationDataLocked) {
      flash("案件已完成理算，请先执行理算回退后再修改账单。");
      return false;
    }
    const totalAmount = Number(billForm.totalAmount);
    const selfPaidAmount = Number(billForm.selfPaidAmount || 0);
    const insuranceFundAmount = Number(billForm.insuranceFundAmount || 0);
    const personalAccountAmount = Number(billForm.personalAccountAmount || 0);
    const cashAmount = Number(billForm.cashAmount || 0);
    if (!billForm.invoiceNo.trim() || !billForm.patientName.trim() || !billForm.institution.trim() || !billForm.billDate || !Number.isFinite(totalAmount) || totalAmount <= 0) {
      flash("请填写票据号码、患者姓名、医疗机构、收费日期和有效的医疗总费用。");
      return false;
    }
    if ([selfPaidAmount, insuranceFundAmount, personalAccountAmount, cashAmount].some((value) => !Number.isFinite(value) || value < 0 || value > totalAmount)) {
      flash("各支付金额应在 0 和医疗总费用之间。");
      return false;
    }
    if (!selectedCase) return false;
    const formulaBenefitIds = automationFormulas
      .filter((formula) => formula.enabled && formula.steps.length)
      .map((formula) => formula.benefitId);
    if (!formulaBenefitIds.length) {
      flash("当前保单尚未配置可用的责任公式。");
      return false;
    }
    let nextAttachmentIds = bindBillCurrentImage && currentAttachmentId ? [currentAttachmentId] : [];
    const editingBill = editingBillId ? bills.find((item) => item.id === editingBillId) : undefined;
    const previousAttachmentId = editingBill?.attachmentIds[0] ?? "";
    const nextAttachmentId = nextAttachmentIds[0] ?? "";
    if (editingBill && previousAttachmentId && previousAttachmentId !== nextAttachmentId) {
      const attachmentName = (uploadId: string) =>
        selectedCase.attachments.find((item) => item.uploadId === uploadId)?.fileName ?? uploadId;
      const decision = await requestAttachmentChangeDecision(
        attachmentName(previousAttachmentId),
        nextAttachmentId ? attachmentName(nextAttachmentId) : undefined,
      );
      if (decision === "cancel") return false;
      if (decision === "keep") nextAttachmentIds = [...editingBill.attachmentIds];
    }
    const response = await apiFetch("/api/automatic-calculation/bills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: editingBillId || undefined,
        claimCaseId: selectedCase.id,
        billData: { ...billForm, attachmentIds: nextAttachmentIds, totalAmount, insuranceFundAmount, personalAccountAmount, cashAmount, selfPaidAmount },
        customValues: customBillValues,
        selectedBenefitIds: formulaBenefitIds,
      }),
    });
    const result = await response.json() as BillEntry & { message?: string };
    if (!response.ok) {
      flash(`账单保存失败：${result.message ?? "请检查录入内容"}`);
      return false;
    }
    setBills((items) => editingBillId
      ? items.map((item) => item.id === result.id ? result : item)
      : [...items, result]);
    setWorkflowByCase((current) => ({ ...current, [selectedCase.id]: "editing" }));
    const insuredParty = selectedCase?.parties.find((party) => party.role === "insured");
    setBillForm(emptyBillForm(insuredParty?.name ?? "", insuredParty?.idNo ?? ""));
    setBindBillCurrentImage(false);
    setEditingBillId("");
    setBillFormOpen(false);
    setCustomBillValues(Object.fromEntries(automationVariables.filter((variable) => variable.category === "bill" && variable.custom).map((variable) => [variable.variableName, variable.defaultValue ?? ""])));
    flash(editingBillId ? "账单已更新，请执行理算。" : "账单已录入，请执行理算并更新台账。");
    return true;
  }

  function editBill(item: BillEntry) {
    setEditingBillId(item.id);
    setBillFormOpen(true);
    setBillForm({
      invoiceCode: item.invoiceCode,
      invoiceNo: item.invoiceNo,
      checkCode: item.checkCode,
      billType: item.billType,
      patientName: item.patientName,
      patientIdNo: item.patientIdNo,
      visitNo: item.visitNo,
      institution: item.institution,
      department: item.department,
      billDate: item.billDate,
      admissionDate: item.admissionDate,
      dischargeDate: item.dischargeDate,
      diagnosis: item.diagnosis,
      medicalInsuranceType: item.medicalInsuranceType,
      settlementNo: item.settlementNo,
      totalAmount: String(item.totalAmount),
      insuranceFundAmount: String(item.insuranceFundAmount),
      personalAccountAmount: String(item.personalAccountAmount),
      cashAmount: String(item.cashAmount),
      selfPaidAmount: String(item.selfPaidAmount),
      cashier: item.cashier,
    });
    setCustomBillValues(Object.fromEntries(Object.entries(item.customValues).map(([key, value]) => [key, String(value)])));
    const attachmentId = item.attachmentIds.find((uploadId) =>
      selectedCase?.attachments.some((attachment) => attachment.uploadId === uploadId),
    ) ?? "";
    setBindBillCurrentImage(Boolean(attachmentId));
    if (attachmentId) {
      setAttachmentsOpen(true);
      setCurrentAttachmentId(attachmentId);
    }
    flash(calculationDataLocked ? `正在查看账单 ${item.invoiceNo}。` : `正在编辑账单 ${item.invoiceNo}。`);
  }

  function startNewBill() {
    if (calculationDataLocked) {
      flash(readOnlyMode ? "当前页面仅支持查看账单。" : "案件已完成理算，请先执行理算回退后再新增账单。");
      return false;
    }
    const insuredParty = selectedCase?.parties.find((party) => party.role === "insured");
    setEditingBillId("");
    setBillFormOpen(true);
    setBillForm(emptyBillForm(insuredParty?.name ?? "", insuredParty?.idNo ?? ""));
    setBindBillCurrentImage(false);
    setCustomBillValues(Object.fromEntries(automationVariables.filter((variable) => variable.category === "bill" && variable.custom).map((variable) => [variable.variableName, variable.defaultValue ?? ""])));
    return true;
  }

  async function removeBill(id: string) {
    if (calculationDataLocked) {
      flash("案件已完成理算，请先执行理算回退后再删除账单。");
      return;
    }
    const response = await apiFetch(`/api/automatic-calculation/bills?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) {
      flash("账单删除失败，请稍后重试。");
      return;
    }
    setBills((items) => items.filter((bill) => bill.id !== id));
    if (editingBillId === id) setEditingBillId("");
    if (selectedCase) setWorkflowByCase((current) => ({ ...current, [selectedCase.id]: "editing" }));
    flash("账单已删除，请执行理算。");
  }

  async function addEvent() {
    if (calculationDataLocked) {
      flash("案件已完成理算，请先执行理算回退后再修改事件。");
      return false;
    }
    if (!eventForm.occurredDate || !eventForm.description.trim()) {
      flash("请填写事件发生日期和事件经过。");
      return false;
    }
    if (!selectedCase) return false;
    const response = await apiFetch("/api/claim-events", {
      method: editingEventId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        ...(editingEventId ? { id: editingEventId } : {}),
        insuredPersonId: selectedCase.insuredPersonId,
        ...eventForm,
      }),
    });
    const result = await response.json() as ClaimPersonEvent & { message?: string };
    if (!response.ok) {
      flash(`事件保存失败：${result.message ?? "请稍后重试"}`);
      return false;
    }
    setEvents((items) => editingEventId
      ? items.map((item) => item.id === editingEventId ? result : item)
      : [...items, result]);
    if (result.id === selectedCase.eventId) {
      setSelectedCase((current) => current ? { ...current, event: result } : current);
      setProcessingCases((items) => items.map((item) => item.id === selectedCase.id ? { ...item, event: result } : item));
      if (calculationResult) setWorkflowByCase((current) => ({ ...current, [selectedCase.id]: "editing" }));
    }
    setEventForm(emptyCalculationEventForm());
    setEditingEventId("");
    setEventFormOpen(false);
    flash(editingEventId ? "事件已更新。" : "事件已录入。");
    return true;
  }

  function startNewEvent() {
    if (calculationDataLocked) {
      flash(readOnlyMode ? "当前页面仅支持查看事件。" : "案件已完成理算，请先执行理算回退后再新增事件。");
      return false;
    }
    setEditingEventId("");
    setEventForm(emptyCalculationEventForm());
    setEventFormOpen(true);
    return true;
  }

  function editEvent(item: ClaimPersonEvent) {
    setEditingEventId(item.id);
    setEventForm({
      eventType: item.eventType,
      occurredDate: item.occurredDate,
      administrativeArea: item.administrativeArea ?? "",
      detailedAddress: item.detailedAddress ?? "",
      hospitalName: item.hospitalName ?? "",
      diagnosis: item.diagnosis ?? "",
      description: item.description,
    });
    setEventFormOpen(true);
  }

  async function associateEvent(item: ClaimPersonEvent) {
    if (!selectedCase || item.id === selectedCase.eventId) return;
    if (calculationDataLocked) {
      flash("更换关联事件前请先执行理算回退。");
      return;
    }
    const currentCase = selectedCase;
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
        eventId: item.id,
        attachments: currentCase.attachments,
      }),
    });
    const result = await response.json() as ClaimCase & { message?: string };
    if (!response.ok) {
      flash(`关联事件失败：${result.message ?? "请稍后重试"}`);
      return;
    }
    setSelectedCase(result);
    setProcessingCases((items) => items.map((entry) => entry.id === result.id ? result : entry));
    setWorkflowByCase((current) => ({ ...current, [result.id]: "editing" }));
    flash(`已关联事件 ${item.eventNo}。`);
  }

  async function addDisease() {
    if (calculationDataLocked) {
      flash("案件已完成理算，请先执行理算回退后再修改疾病信息。");
      return false;
    }
    if (!diseaseForm.diseaseName.trim() || !diseaseForm.diagnosisDate || !diseaseForm.hospital.trim()) {
      flash("请填写疾病名称、确诊日期和确诊医院。");
      return false;
    }
    if (!selectedCase) return false;
    const response = await apiFetch("/api/automatic-calculation/diseases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editingDiseaseId || undefined, claimCaseId: selectedCase.id, ...diseaseForm }),
    });
    const result = await response.json() as DiseaseEntry & { message?: string };
    if (!response.ok) {
      flash(`疾病保存失败：${result.message ?? "请稍后重试"}`);
      return false;
    }
    setDiseases((items) => editingDiseaseId
      ? items.map((item) => item.id === editingDiseaseId ? result : item)
      : [...items, result]);
    setDiseaseForm({ diseaseName: "", icdCode: "", diagnosisDate: "", hospital: "", note: "" });
    setEditingDiseaseId("");
    setDiseaseFormOpen(false);
    flash(editingDiseaseId ? "疾病已更新。" : "疾病已录入。");
    return true;
  }

  async function removeDiseaseEntry(id: string) {
    if (calculationDataLocked) {
      flash("案件已完成理算，请先执行理算回退后再删除疾病信息。");
      return;
    }
    const response = await apiFetch(`/api/automatic-calculation/diseases?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) {
      flash("疾病删除失败，请稍后重试。");
      return;
    }
    setDiseases((items) => items.filter((disease) => disease.id !== id));
    flash("疾病已删除。");
  }

  function startNewDisease() {
    if (calculationDataLocked) {
      flash(readOnlyMode ? "当前页面仅支持查看疾病信息。" : "案件已完成理算，请先执行理算回退后再新增疾病信息。");
      return false;
    }
    setEditingDiseaseId("");
    setDiseaseForm({ diseaseName: "", icdCode: "", diagnosisDate: "", hospital: "", note: "" });
    setDiseaseFormOpen(true);
    return true;
  }

  function editDisease(item: DiseaseEntry) {
    setEditingDiseaseId(item.id);
    setDiseaseForm({ diseaseName: item.diseaseName, icdCode: item.icdCode, diagnosisDate: item.diagnosisDate, hospital: item.hospital, note: item.note });
    setDiseaseFormOpen(true);
  }

  async function runCalculation() {
    if (!selectedCase) return false;
    if (calculationIsCurrent) {
      flash("当前数据已经完成理算；如需重算，请先修改理算数据或执行理算回退。");
      return false;
    }
    if (!bills.length) {
      flash("请先录入至少一张账单，再进行理算。");
      setActiveTab("bill");
      return false;
    }
    const response = await apiFetch("/api/automatic-calculation/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimCaseId: selectedCase.id }),
    });
    const result = await response.json() as AutomaticCalculationResult & { message?: string };
    if (!response.ok) {
      flash(`自动理算失败：${result.message ?? "请检查责任公式和账单责任选择"}`);
      return false;
    }
    setCalculationResult(result);
    setSelectedCase((current) => current ? { ...current, status: "calculating" } : current);
    setLedgerBalances(result.ledgerBalances);
    setWorkflowByCase((current) => ({ ...current, [selectedCase.id]: "calculated" }));
    setBillFormOpen(false);
    setEventFormOpen(false);
    setDiseaseFormOpen(false);
    setEditingBillId("");
    setEditingEventId("");
    setEditingDiseaseId("");
    flash(`自动理算及台账更新完成，本次案件给付金额为 ¥ ${money(result.totalAmount)}。`);
    return true;
  }

  function openCalculationProcess() {
    if (!calculationResult) return;
    const firstBillId = processBills[0]?.id ?? "";
    const firstBenefitId = calculationResult.billResults.find((item) => item.billId === firstBillId && item.matched !== false)?.benefitId ?? "";
    setSelectedProcessBillId(firstBillId);
    setSelectedProcessBenefitId(firstBenefitId);
    setCalculationProcessOpen(true);
  }

  function selectProcessBill(billId: string) {
    setSelectedProcessBillId(billId);
    setSelectedProcessBenefitId(calculationResult?.billResults.find((item) => item.billId === billId && item.matched !== false)?.benefitId ?? "");
  }

  async function rollbackCalculation() {
    if (!selectedCase || !calculationResult) return false;
    setRollbackPromptOpen(false);
    const response = await apiFetch("/api/automatic-calculation/rollback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimCaseId: selectedCase.id }),
    });
    const result = await response.json() as { success?: boolean; ledgerBalances?: LedgerBalanceView[]; message?: string };
    if (!response.ok) {
      flash(`理算回退失败：${result.message ?? "请稍后重试"}`);
      return false;
    }
    setCalculationResult(null);
    setSelectedCase((current) => current ? { ...current, status: "entering" } : current);
    setCalculationProcessOpen(false);
    setLedgerDrawerOpen(false);
    setSelectedProcessBillId("");
    setSelectedProcessBenefitId("");
    setLedgerBalances(result.ledgerBalances ?? []);
    setWorkflowByCase((current) => ({ ...current, [selectedCase.id]: "editing" }));
    flash("理算已回退，理算过程和结果已删除，台账已冲回。");
    return true;
  }

  async function submitCalculation() {
    if (!selectedCase) return false;
    if (workflowStatus !== "calculated") {
      flash("请先完成理算，再提交理算结果。");
      return false;
    }
    const currentCase = selectedCase;
    const response = await apiFetch("/api/claim-registrations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ id: currentCase.id, action: "review" }),
    });
    if (!response.ok) {
      flash("理算结果提交失败，案件状态可能已经变化。");
      return false;
    }
    setProcessingCases((items) => items.filter((item) => item.id !== currentCase.id));
    setSelectedCase(null);
    window.dispatchEvent(new Event("claim-case-status-changed"));
    flash(`案件 ${currentCase.caseNo} 已提交审核。`);
    return true;
  }

  async function completeReview() {
    if (!selectedCase || !reviewMode) return false;
    const currentCase = selectedCase;
    const response = await apiFetch("/api/claim-registrations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ id: currentCase.id, action: "complete" }),
    });
    if (!response.ok) {
      flash("审核结案失败，案件状态可能已经变化。");
      return false;
    }
    setProcessingCases((items) => items.filter((item) => item.id !== currentCase.id));
    setSelectedCase(null);
    window.dispatchEvent(new Event("claim-case-status-changed"));
    flash(`案件 ${currentCase.caseNo} 已审核结案。`);
    return true;
  }

  async function rollbackCase() {
    if (!selectedCase) return false;
    const currentCase = selectedCase;
    setCaseRollbackPromptOpen(false);
    const response = await apiFetch("/api/claim-registrations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ id: currentCase.id, action: "rollback" }),
    });
    const result = await response.json() as ClaimCase & { message?: string };
    if (!response.ok) { flash(`案件回退失败：${result.message ?? "案件状态可能已经变化"}`); return false; }
    setProcessingCases((items) => items.filter((item) => item.id !== currentCase.id));
    setSelectedCase(null);
    window.dispatchEvent(new Event("claim-case-status-changed"));
    flash(`案件 ${currentCase.caseNo} 已回退至${detailStatusLabels[result.status]}，并退给 ${result.currentHandlerName}。`);
    return true;
  }

  async function withdrawCase() {
    if (!selectedCase) return false;
    const currentCase = selectedCase;
    setWithdrawPromptOpen(false);
    const response = await apiFetch("/api/claim-registrations", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ id: currentCase.id, action: "cancel" }),
    });
    if (!response.ok) {
      flash("撤件失败，案件状态可能已经变化。");
      return false;
    }
    setProcessingCases((items) => items.filter((item) => item.id !== currentCase.id));
    setSelectedCase(null);
    flash(`案件 ${currentCase.caseNo} 已撤件。`);
    return true;
  }

  useImperativeHandle(assistantRef, () => {
    const pageId = reviewMode ? "claim_review_completion" : "claim_entry_calculation";
    const updateBillField = (fieldId: string, value: string) => {
      if (!(fieldId in assistantStateRef.current.billForm)) return false;
      const next = { ...assistantStateRef.current.billForm, [fieldId]: value };
      assistantStateRef.current = { ...assistantStateRef.current, billForm: next };
      setBillForm(next);
      return true;
    };
    const eventFieldMap: Record<string, keyof typeof eventForm> = {
      eventType: "eventType",
      eventOccurredDate: "occurredDate",
      eventAdministrativeArea: "administrativeArea",
      eventDetailedAddress: "detailedAddress",
      eventHospitalName: "hospitalName",
      eventDiagnosis: "diagnosis",
      eventDescription: "description",
    };
    const diseaseFieldMap: Record<string, keyof typeof diseaseForm> = {
      diseaseName: "diseaseName",
      diseaseIcdCode: "icdCode",
      diseaseDiagnosisDate: "diagnosisDate",
      diseaseHospital: "hospital",
      diseaseNote: "note",
    };
    const openListItem = (item?: ClaimCase) => {
      if (!item) return { type: "operation_error", reason: "item_not_found", pageId };
      const statusAllowed = reviewMode ? item.status === "reviewing" : item.status === "entering" || item.status === "calculating";
      if (!statusAllowed) return { type: "operation_error", reason: "claim_case_not_available_on_page", pageId, status: item.status };
      openCase(item);
      return { type: "detail_view", pageId, caseId: item.id, caseNo: item.caseNo, status: item.status };
    };
    const executeListItemAction = async (actionId: string, item: ClaimCase | undefined) => {
      if (actionId === "open_case" || actionId === "view_case") return openListItem(item);
      return { type: "operation_error", reason: "row_action_executor_not_bound", pageId, actionId };
    };

    return {
      async setField(fieldId, value) {
        if (fieldId === "caseKeyword") {
          assistantStateRef.current = { ...assistantStateRef.current, caseKeyword: value };
          setCaseKeyword(value);
          setCasePage(1);
          return { type: "field_updated", pageId, fieldId, value };
        }
        if (fieldId === "eventKeyword") { setEventKeyword(value); return { type: "field_updated", pageId, fieldId, value }; }
        if (fieldId === "eventTypeFilter") { setEventTypeFilter(value); return { type: "field_updated", pageId, fieldId, value }; }
        if (fieldId === "eventDateFilter") { setEventDateFilter(value); return { type: "field_updated", pageId, fieldId, value }; }
        if (updateBillField(fieldId, value)) return { type: "field_updated", pageId, fieldId, value };
        const eventKey = eventFieldMap[fieldId];
        if (eventKey) {
          const next = { ...assistantStateRef.current.eventForm, [eventKey]: value };
          assistantStateRef.current = { ...assistantStateRef.current, eventForm: next };
          setEventForm(next);
          return { type: "field_updated", pageId, fieldId, value };
        }
        const diseaseKey = diseaseFieldMap[fieldId];
        if (diseaseKey) {
          const next = { ...assistantStateRef.current.diseaseForm, [diseaseKey]: value };
          assistantStateRef.current = { ...assistantStateRef.current, diseaseForm: next };
          setDiseaseForm(next);
          return { type: "field_updated", pageId, fieldId, value };
        }
        return { type: "operation_error", reason: "field_executor_not_bound", pageId, fieldId };
      },
      async executeAction(actionId) {
        if (actionId === "reset" || actionId === "back_to_list") {
          setSelectedCase(null);
          setCaseKeyword("");
          setCasePage(1);
          assistantStateRef.current = { ...assistantStateRef.current, selectedCase: null, caseKeyword: "" };
          return { type: "page_action", pageId, actionId };
        }
        if (actionId === "search" || actionId === "refresh") {
          const result = await loadProcessingCases(1, assistantStateRef.current.caseKeyword);
          return { type: "list_result", pageId, total: result?.total ?? 0, items: result?.items.map((item) => ({ itemId: item.id, caseNo: item.caseNo, policyNo: item.policyNo, status: item.status })) ?? [] };
        }
        if (!assistantStateRef.current.selectedCase) return {
          type: "operation_error",
          reason: "claim_case_required",
          pageId,
          actionId,
          recovery: {
            tool: "click_list_item_action",
            pageId,
            actionId: "open_case",
            itemIdSource: "backendToolResults",
          },
        };
        if (actionId === "show_acceptance") { setActiveTab("acceptance_basic"); return { type: "detail_view", pageId, region: "acceptance" }; }
        if (actionId === "show_bills") { setActiveTab("bill"); return { type: "detail_view", pageId, region: "bills", count: assistantStateRef.current.bills.length }; }
        if (actionId === "show_events") { setActiveTab("event"); return { type: "detail_view", pageId, region: "events", count: assistantStateRef.current.events.length }; }
        if (actionId === "show_diseases") { setActiveTab("disease"); return { type: "detail_view", pageId, region: "diseases", count: assistantStateRef.current.diseases.length }; }
        if (actionId === "toggle_attachments") { setAttachmentsOpen((open) => !open); return { type: "page_action", pageId, actionId }; }
        if (actionId === "open_personal_ledger") { setLedgerDrawerOpen(true); return { type: "detail_view", pageId, region: "personal_ledger", count: ledgerBalances.length }; }
        if (actionId === "open_calculation_process") { openCalculationProcess(); return { type: "detail_view", pageId, region: "calculation_process" }; }
        if (actionId === "start_new_bill") {
          setActiveTab("bill");
          return startNewBill()
            ? { type: "editor_opened", pageId, editor: "bill" }
            : { type: "operation_error", reason: readOnlyMode ? "read_only_page" : "calculation_data_locked", pageId, actionId };
        }
        if (actionId === "save_bill") return { type: "mutation_result", pageId, operation: actionId, success: await addBill() };
        if (actionId === "start_new_event") {
          setActiveTab("event");
          return startNewEvent()
            ? { type: "editor_opened", pageId, editor: "event" }
            : { type: "operation_error", reason: readOnlyMode ? "read_only_page" : "calculation_data_locked", pageId, actionId };
        }
        if (actionId === "save_event") return { type: "mutation_result", pageId, operation: actionId, success: await addEvent() };
        if (actionId === "start_new_disease") {
          setActiveTab("disease");
          return startNewDisease()
            ? { type: "editor_opened", pageId, editor: "disease" }
            : { type: "operation_error", reason: readOnlyMode ? "read_only_page" : "calculation_data_locked", pageId, actionId };
        }
        if (actionId === "save_disease") return { type: "mutation_result", pageId, operation: actionId, success: await addDisease() };
        if (actionId === "run_calculation") return { type: "mutation_result", pageId, operation: actionId, success: await runCalculation() };
        if (actionId === "request_calculation_rollback") { setRollbackPromptOpen(true); return { type: "confirmation_required", pageId, operation: actionId }; }
        if (actionId === "confirm_calculation_rollback") {
          if (!assistantStateRef.current.rollbackPromptOpen) return { type: "operation_error", reason: "confirmation_required", pageId, actionId };
          return { type: "mutation_result", pageId, operation: actionId, success: await rollbackCalculation() };
        }
        if (actionId === "submit_review") return { type: "mutation_result", pageId, operation: actionId, success: await submitCalculation() };
        if (actionId === "request_case_rollback") { setCaseRollbackPromptOpen(true); return { type: "confirmation_required", pageId, operation: actionId }; }
        if (actionId === "confirm_case_rollback") {
          if (!assistantStateRef.current.caseRollbackPromptOpen) return { type: "operation_error", reason: "confirmation_required", pageId, actionId };
          return { type: "mutation_result", pageId, operation: actionId, success: await rollbackCase() };
        }
        if (actionId === "request_withdraw") { setWithdrawPromptOpen(true); return { type: "confirmation_required", pageId, operation: actionId }; }
        if (actionId === "confirm_withdraw") {
          if (!assistantStateRef.current.withdrawPromptOpen) return { type: "operation_error", reason: "confirmation_required", pageId, actionId };
          return { type: "mutation_result", pageId, operation: actionId, success: await withdrawCase() };
        }
        if (actionId === "complete_review") return { type: "mutation_result", pageId, operation: actionId, success: await completeReview() };
        return { type: "operation_error", reason: "action_executor_not_bound", pageId, actionId };
      },
      async executeRowAction(actionId, row) {
        return executeListItemAction(actionId, assistantStateRef.current.processingCases[row - 1]);
      },
      async executeItemAction(actionId, itemId) {
        let item = assistantStateRef.current.processingCases.find((candidate) => candidate.id === itemId);
        if (!item) {
          const response = await apiFetch(`/api/claim-registrations?id=${encodeURIComponent(itemId)}&page=1&pageSize=1`, { cache: "no-store" });
          if (response.ok) {
            const result = await response.json() as ProcessingCaseResult;
            item = result.items[0];
          }
        }
        return executeListItemAction(actionId, item);
      },
      getRuntimeFieldOptions() { return {}; },
      getRuntimeCapabilities() {
        const state = assistantStateRef.current;
        if (!state.selectedCase) {
          return {
            availableActionIds: ["search", "refresh", "reset", "open_case"],
            availableFieldIds: ["caseKeyword"],
          };
        }
        return {
          unavailableActionIds: [
            state.rollbackPromptOpen ? "request_calculation_rollback" : "confirm_calculation_rollback",
            state.caseRollbackPromptOpen ? "request_case_rollback" : "confirm_case_rollback",
            state.withdrawPromptOpen ? "request_withdraw" : "confirm_withdraw",
          ],
        };
      },
    };
  });

  if (!selectedCase) {
    return (
      <div className="entry-calculation-page entry-case-query-page">
        <section className="panel entry-case-heading">
          <div>
            <div className="section-title">{reviewMode ? "审核结案" : "录入与理算"}</div>
            <p>{reviewMode ? "查看已完成理算并提交审核的案件；案件信息仅供审核查看，不可修改。" : "请选择从“受理立案”提交上来的案件，再录入账单、事件和疾病信息。"}</p>
          </div>
          <button className="secondary-button" type="button" disabled={caseLoading} onClick={() => void loadProcessingCases(casePage, caseKeyword)}>
            {caseLoading ? "刷新中…" : "刷新案件"}
          </button>
        </section>

        <section className="panel entry-case-list-panel">
          <div className="entry-case-list-tools">
            <div>
              <div className="section-title">{reviewMode ? "审核案件" : "录入与理算案件"}</div>
              <small className="muted">{reviewMode ? "仅展示理算提交后进入“审核”的案件" : "展示处于“录入”或“理算”状态的案件"}</small>
            </div>
            <label className="entry-case-search">
              <span>搜索案件</span>
              <input className="filter-control" value={caseKeyword} onChange={(event) => { setCaseKeyword(event.target.value); setCasePage(1); }} placeholder="案件号、保单号、被保人、证件号或事件号" />
            </label>
          </div>
          {caseError ? <p className="field-error">{caseError}</p> : null}
          <div className="table-wrapper entry-case-table">
            <table>
              <thead><tr><th>案件号</th><th>保单号</th><th>被保人</th><th>证件号</th><th>关联事件</th><th>报案日期</th><th>状态</th><th>提交时间</th><th>操作</th></tr></thead>
              <tbody>
                {caseLoading ? (
                  <tr><td className="config-empty-cell" colSpan={9}>正在加载{reviewMode ? "审核" : "录入、理算"}案件…</td></tr>
                ) : processingCases.length ? processingCases.map((item) => {
                  const insured = item.parties.find((party) => party.role === "insured");
                  return (
                    <tr key={item.id} onDoubleClick={() => openCase(item)}>
                      <td><strong>{item.caseNo}</strong></td>
                      <td>{item.policyNo}</td>
                      <td>{insured?.name ?? "-"}</td>
                      <td>{insured?.idNo ?? "-"}</td>
                      <td>{item.event.eventNo}</td>
                      <td>{item.reportDate}</td>
                      <td><span className={`status-badge claim-${item.status}`}>{detailStatusLabels[item.status]}</span></td>
                      <td>{new Date(item.updatedAt).toLocaleString("zh-CN", { hour12: false })}</td>
                      <td><button type="button" className="action-link" onClick={() => openCase(item)}>{reviewMode ? "查看" : "编辑"}</button></td>
                    </tr>
                  );
                }) : (
                  <tr><td className="config-empty-cell" colSpan={9}>{caseKeyword ? `没有找到匹配的${reviewMode ? "审核" : "录入、理算"}案件。` : reviewMode ? "暂无审核案件，请先在录入与理算页面提交案件。" : "暂无录入或理算案件，请先在受理立案中提交案件。"}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <span className="pagination-info">第 {casePage} / {caseTotalPages} 页，共 {caseTotal} 条，每页 {casePageSize} 条</span>
            <button type="button" className="page-btn" disabled={casePage <= 1 || caseLoading} onClick={() => setCasePage((page) => Math.max(1, page - 1))}>上一页</button>
            <button type="button" className="page-btn" disabled={casePage >= caseTotalPages || caseLoading} onClick={() => setCasePage((page) => Math.min(caseTotalPages, page + 1))}>下一页</button>
          </div>
        </section>
      </div>
    );
  }

  const insured = selectedCase.parties.find((party) => party.role === "insured");

  return (
    <div className={`claim-image-push-stage ${attachmentsOpen ? "image-open" : ""}`}>
      <ClaimWorkflowDialogs
        attachmentChange={attachmentChangePrompt}
        calculationRollbackOpen={rollbackPromptOpen}
        caseRollbackOpen={caseRollbackPromptOpen}
        withdrawOpen={withdrawPromptOpen}
        caseNo={selectedCase.caseNo}
        onAttachmentDecision={resolveAttachmentChangeDecision}
        onCalculationRollback={rollbackCalculation}
        onCloseCalculationRollback={() => setRollbackPromptOpen(false)}
        onCaseRollback={rollbackCase}
        onCloseCaseRollback={() => setCaseRollbackPromptOpen(false)}
        onWithdraw={withdrawCase}
        onCloseWithdraw={() => setWithdrawPromptOpen(false)}
      />
      {calculationProcessOpen && calculationResult ? (
        <div className="calculation-process-overlay" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setCalculationProcessOpen(false);
        }}>
          <aside className="calculation-process-drawer" role="dialog" aria-modal="true" aria-labelledby="calculation-process-title">
            <div className="calculation-process-header">
              <div>
                <div className="section-title" id="calculation-process-title">自动理算过程</div>
                <small>运行号 {calculationResult.runNo} ｜ 先选择账单，再选择保障责任</small>
              </div>
              <button type="button" className="secondary-button" onClick={() => setCalculationProcessOpen(false)}>关闭</button>
            </div>
            <div className="calculation-process-content">
              <div className="calculation-process-browser">
                <section className="calculation-process-bill-panel">
                  <div className="calculation-process-list-title"><strong>账单列表</strong><span>{processBills.length} 张</span></div>
                  <div className="calculation-process-bill-list">
                    <div className="calculation-process-bill-header">
                      <span>票据号码</span><span>票据类型</span><span>医疗机构</span><span>收费日期</span><span>医疗总费用</span><span>匹配责任</span><span>理算金额</span>
                    </div>
                    {processBills.map((bill) => (
                      <button type="button" className={selectedProcessBillId === bill.id ? "active" : ""} key={bill.id} onClick={() => selectProcessBill(bill.id)}>
                        <strong>{bill.invoiceNo}</strong>
                        <span>{bill.billType}</span>
                        <span title={bill.institution}>{bill.institution}</span>
                        <span>{bill.billDate}</span>
                        <span>¥ {money(bill.totalAmount)}</span>
                        <span>{bill.matchedBenefitCount} 个</span>
                        <b>¥ {money(bill.calculationAmount)}</b>
                      </button>
                    ))}
                  </div>
                </section>
                <div className="calculation-process-lower">
                <section className="calculation-process-list-panel">
                  <div className="calculation-process-list-title"><strong>匹配责任</strong><span>{processBenefitResults.length} 个</span></div>
                  <div className="calculation-process-list">
                    {processBenefitResults.length ? processBenefitResults.map((item) => (
                      <button type="button" className={selectedProcessBenefitId === item.benefitId ? "active" : ""} key={item.benefitId} onClick={() => setSelectedProcessBenefitId(item.benefitId)}>
                        <span>{item.benefitCode}</span>
                        <strong>{item.benefitName}</strong>
                        <small>给付 ¥ {money(item.amount)}</small>
                      </button>
                    )) : <div className="calculation-process-list-empty">该账单没有通过自动匹配条件的责任。</div>}
                  </div>
                </section>
                <div className="calculation-process-detail">
              {selectedProcessResult ? (() => {
                const item = selectedProcessResult;
                const configuredMatchExpression = automationFormulas.find((formula) => formula.benefitId === item.benefitId)?.matchExpression ?? "";
                return (
                  <section className="calculation-process-card">
                    <div className="calculation-process-card-title">
                      <div><strong>{item.invoiceNo} · {item.benefitName}</strong><small>{item.formulaName}</small></div>
                      <b>给付 ¥ {money(item.amount)}</b>
                    </div>
                    <div className="calculation-process-match">
                      <span>自动匹配条件</span>
                      <code>{(item.matchExpression ?? configuredMatchExpression) || "无条件"}</code>
                      <small>参数替换后：{item.substitutedMatchExpression || "无条件"}</small>
                      <p>匹配结果：<b>{item.matched === false ? "不通过，已停止后续计算" : "通过"}</b></p>
                    </div>
                    {item.steps.length ? <ol className="calculation-process-steps">
                      {item.steps.map((step, stepIndex) => (
                        <li key={step.id}>
                          <div><span>第 {stepIndex + 1} 步</span><strong>{step.name}</strong>{step.result ? <em>最终结果</em> : null}</div>
                          <code>{step.expression}</code>
                          <small>参数替换后：{step.substitutedExpression}</small>
                          <p>
                            本步结果：<b>{typeof step.value === "number" ? money(step.value) : String(step.value)}</b>
                            {step.ledgerTarget ? ` ｜ 累计至${step.ledgerTarget.name}` : ""}
                            {step.ledgerOpening !== undefined && step.ledgerClosing !== undefined ? ` ｜ 台账 ${money(step.ledgerOpening)} → ${money(step.ledgerClosing)}` : ""}
                          </p>
                        </li>
                      ))}
                    </ol> : <div className="calculation-process-empty">{item.matched === false ? "自动匹配条件未通过，本责任未执行后续公式步骤。" : "本责任没有可显示的公式步骤。"}</div>}
                  </section>
                );
              })() : <div className="calculation-process-empty">请选择一个通过自动匹配条件的责任查看理算过程。</div>}
                </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
      {ledgerDrawerOpen ? (
        <div className="calculation-process-overlay" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setLedgerDrawerOpen(false);
        }}>
          <aside className="calculation-ledger-drawer" role="dialog" aria-modal="true" aria-labelledby="annual-ledger-title">
            <div className="calculation-process-header">
              <div>
                <div className="section-title" id="annual-ledger-title">人员责任年度台账</div>
                <small>自动带入历史案件累计值；本案理算或回退后同步更新当前值</small>
              </div>
              <button type="button" className="secondary-button" onClick={() => setLedgerDrawerOpen(false)}>关闭</button>
            </div>
            <div className="calculation-ledger-drawer-content">
              <div className="calculation-ledger-drawer-summary"><strong>{ledgerBalances.length}</strong><span>个台账项目</span></div>
              <div className="calculation-ledger-groups">
                {ledgerGroups.map((group) => (
                  <section className={`calculation-ledger-group ${group.key}`} key={group.key}>
                    <div className="calculation-ledger-group-header">
                      <div><strong>{group.title}</strong><small>{group.description}</small></div>
                      <span>{group.targets.length} 个对象 · {group.itemCount} 项</span>
                    </div>
                    <div className="calculation-ledger-targets">
                      {group.targets.map((target) => (
                        <article className="calculation-ledger-target-card" key={target.id}>
                          <div className="calculation-ledger-target-title"><strong>{target.name}</strong><span>{target.items[0]?.periodYear} 年</span></div>
                          <div className="calculation-ledger-target-items">
                            {target.items.map((ledger) => (
                              <div key={`${ledger.benefitId}-${ledger.ledgerCode}`}>
                                <span>{ledger.ledgerName}</span>
                                <strong>¥ {money(ledger.currentAmount)}</strong>
                                <small>{ledger.configuredAmount === undefined ? "当前累计值" : `配置 ¥ ${money(ledger.configuredAmount)} · 剩余 ¥ ${money(ledger.remainingAmount ?? 0)}`}</small>
                              </div>
                            ))}
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </aside>
        </div>
      ) : null}
      <ClaimImageWorkspace
        open={attachmentsOpen}
        caseNo={selectedCase.caseNo}
        attachments={selectedCase.attachments}
        busy={attachmentBusy}
        readOnly={calculationDataLocked}
        onClose={() => setAttachmentsOpen(false)}
        onUpload={(files) => void uploadCalculationAttachments(files)}
        onRemove={(uploadId) => void removeCalculationAttachment(uploadId)}
        onSelectionChange={setCurrentAttachmentId}
        selectedUploadId={currentAttachmentId}
      />
      <div className="entry-calculation-page">
      {message && <div className="entry-feedback">{message}</div>}

      <section className="panel entry-page-header">
        <div>
          <div className="section-title">{selectedCase.caseNo} · {insured?.name ?? "未知被保人"}</div>
          <p>保单号 {selectedCase.policyNo} ｜ 关联事件 {selectedCase.event.eventNo} ｜ 报案日期 {selectedCase.reportDate}</p>
        </div>
        <div className="entry-header-actions">
          <button type="button" className="secondary-button" disabled={!ledgerBalances.length} onClick={() => setLedgerDrawerOpen(true)}>个人台账</button>
          {readOnlyMode && calculationResult ? <button type="button" className="secondary-button" onClick={openCalculationProcess}>理算过程</button> : null}
          {!readOnlyMode && !hasCalculationResult ? <button type="button" onClick={() => void runCalculation()}>开始理算</button> : null}
          {!readOnlyMode && calculationIsCurrent ? <button type="button" className="secondary-button" onClick={openCalculationProcess}>理算过程</button> : null}
          {!readOnlyMode && hasCalculationResult ? <button type="button" className="danger-button" onClick={() => setRollbackPromptOpen(true)}>理算回退</button> : null}
          {reviewMode ? <><button type="button" className="secondary-button" onClick={() => setCaseRollbackPromptOpen(true)}>审核回退</button><button type="button" onClick={() => void completeReview()}>审核结案</button></> : queryMode ? null : <button type="button" disabled={!calculationIsCurrent} onClick={() => void submitCalculation()}>提交</button>}
          {!readOnlyMode && selectedCase.status === "entering" ? <button type="button" className="secondary-button" onClick={() => setCaseRollbackPromptOpen(true)}>退回受理</button> : null}
          {!readOnlyMode ? <button type="button" className="danger-button" onClick={() => setWithdrawPromptOpen(true)}>撤件</button> : null}
          <button className="page-back-button" type="button" onClick={() => queryMode ? onClose?.() : setSelectedCase(null)}>返回上一页</button>
        </div>
      </section>

      <div className="entry-calculation-scroll-content">
      <section className="panel entry-summary-panel">
        <div className="entry-summary">
          <div><span>处理状态</span><strong>{detailStatusLabels[selectedCase.status]}</strong></div>
          <div><span>当前处理人</span><strong>{selectedCase.currentHandlerName}</strong></div>
          <div><span>账单数</span><strong>{bills.length}</strong></div>
          <div><span>费用合计</span><strong>¥ {money(totals.total)}</strong></div>
          <div><span>自费合计</span><strong>¥ {money(totals.selfPaid)}</strong></div>
          <div className="entry-summary-primary"><span>自动理算金额</span><strong>{calculationIsCurrent || readOnlyMode ? calculationResult ? `¥ ${money(calculationResult.totalAmount)}` : "-" : "-"}</strong></div>
        </div>
      </section>
      {calculationResult && (calculationIsCurrent || readOnlyMode) ? (
        <section className="panel automatic-result-panel">
          <div className="panel-title-row"><div><div className="section-title">案件自动理算结果</div><small className="muted">运行号 {calculationResult.runNo} ｜ 已理算并落账</small></div><div className="automatic-result-actions"><strong className="automatic-result-total">¥ {money(calculationResult.totalAmount)}</strong></div></div>
          <div className="automatic-case-result-grid">
            <div><span>案件给付金额</span><strong>¥ {money(calculationResult.totalAmount)}</strong></div>
            <div><span>参加理算账单</span><strong>{calculationResult.billCount ?? new Set(calculationResult.billResults.map((item) => item.billId)).size} 张</strong></div>
            <div><span>账单责任结果</span><strong>{calculationResult.responsibilityResultCount ?? calculationResult.billResults.length} 条</strong></div>
            <div><span>理算完成时间</span><strong>{new Date(calculationResult.createdAt).toLocaleString("zh-CN", { hour12: false })}</strong></div>
          </div>
        </section>
      ) : null}

      <div className="entry-layout">
        <aside className="panel entry-side-tabs">
          <button className={attachmentsOpen ? "active" : ""} onClick={() => setAttachmentsOpen((open) => !open)}>
            <span>09</span><div><strong>影像件</strong><small>{selectedCase.attachments.length} 件资料</small></div>
          </button>
          <div className="entry-side-tabs-group-label">受理信息</div>
          {acceptanceReviewSections.map((item) => (
            <button className={activeTab === item.tab ? "active" : ""} key={item.tab} onClick={() => setActiveTab(item.tab)}>
              <span>{item.number}</span><div><strong>{item.label}</strong><small>{item.tab === "acceptance_remark" ? (selectedCase.remarks?.length ? `${selectedCase.remarks.length} 条备注` : "暂无备注") : calculationDataLocked ? "只读查看" : "可查看维护"}</small></div>
            </button>
          ))}
          <div className="entry-side-tabs-group-label">理赔处理</div>
          <button className={activeTab === "bill" ? "active" : ""} onClick={() => setActiveTab("bill")}>
            <span>06</span><div><strong>{readOnlyMode ? "账单信息" : "账单录入"}</strong><small>{bills.length} 条账单</small></div>
          </button>
          <button className={activeTab === "event" ? "active" : ""} onClick={() => setActiveTab("event")}>
            <span>07</span><div><strong>事件信息</strong><small>{events.length} 条事件</small></div>
          </button>
          <button className={activeTab === "disease" ? "active" : ""} onClick={() => setActiveTab("disease")}>
            <span>08</span><div><strong>{readOnlyMode ? "疾病信息" : "疾病录入"}</strong><small>{diseases.length} 条疾病</small></div>
          </button>
        </aside>

        <div className="entry-main">
          {activeTab.startsWith("acceptance_") ? <ClaimRegistrationPage
            embeddedCase={selectedCase}
            readOnly={calculationDataLocked}
            remarkStage={reviewMode ? "review" : "calculation"}
            allowRemarkAdd={!queryMode}
            compactEmbedded
            embeddedSection={acceptanceReviewSections.find((item) => item.tab === activeTab)?.section ?? "basic"}
            onCaseUpdated={(updated) => {
              setSelectedCase(updated);
              setProcessingCases((items) => items.map((item) => item.id === updated.id ? updated : item));
              flash("受理信息已更新，并同步到当前理算案件。");
            }}
          /> : null}
          {activeTab === "bill" && (
            <>
              <section className="panel entry-list-panel">
                <div className="panel-title-row"><div className="section-title">已录入账单</div><span className="muted">共 {bills.length} 条</span></div>
                <div className="table-wrapper">
                  <table className="entry-medical-bill-table"><thead><tr><th>票据号码</th><th>患者</th><th>票据类型</th><th>医疗机构</th><th>收费日期</th><th>医疗总费用</th><th>自费金额</th><th>影像件</th><th className="entry-bill-operation-column">操作</th></tr></thead>
                    <tbody>{bills.length ? bills.map((item) => <tr key={item.id}><td><strong>{item.invoiceNo}</strong></td><td>{item.patientName}</td><td>{activeBillTypeOptions.find((option) => option.value === item.billType)?.label}</td><td>{item.institution}</td><td>{item.billDate}</td><td>¥ {money(item.totalAmount)}</td><td>¥ {money(item.selfPaidAmount)}</td><td>{item.attachmentIds.length ? `${item.attachmentIds.length} 件` : "-"}</td><td className="entry-bill-operation-column">{calculationDataLocked ? <button className="action-link" onClick={() => editBill(item)}>查看</button> : <><button className="action-link" onClick={() => editBill(item)}>编辑</button><button className="danger-link" onClick={() => void removeBill(item.id)}>删除</button></>}</td></tr>) : <tr><td className="config-empty-cell" colSpan={9}>{calculationDataLocked ? "暂无账单。" : "暂无账单，请点击下方“新增账单”。"}</td></tr>}</tbody>
                  </table>
                </div>
                {!calculationDataLocked ? <div className="entry-list-add-row"><button type="button" onClick={startNewBill}><b>＋</b> 新增账单</button></div> : null}
              </section>
              {billFormOpen ? <section className="panel" ref={billFormSectionRef}>
                <div className="section-title">{calculationDataLocked ? `账单信息 · ${billForm.invoiceNo}` : "录入账单"}</div>
                <fieldset className="entry-form-grid" disabled={calculationDataLocked}>
                  <div className="entry-form-section-title">票据信息</div>
                  <label><span>票据代码</span><input value={billForm.invoiceCode} onChange={(event) => setBillForm({ ...billForm, invoiceCode: event.target.value })} placeholder="电子票据代码" /></label>
                  <label><span>票据号码 <b>*</b></span><input value={billForm.invoiceNo} onChange={(event) => setBillForm({ ...billForm, invoiceNo: event.target.value })} placeholder="请输入票据号码" /></label>
                  <label><span>校验码</span><input value={billForm.checkCode} onChange={(event) => setBillForm({ ...billForm, checkCode: event.target.value })} placeholder="票据校验码" /></label>
                  <label><span>票据类型</span><AppSelect ariaLabel="票据类型" disabled={calculationDataLocked} value={billForm.billType} options={activeBillTypeOptions} onChange={(billType) => setBillForm({ ...billForm, billType })} /></label>

                  <div className="entry-form-section-title">患者与就诊信息</div>
                  <label><span>患者姓名 <b>*</b></span><input value={billForm.patientName} onChange={(event) => setBillForm({ ...billForm, patientName: event.target.value })} /></label>
                  <label><span>患者证件号码</span><input value={billForm.patientIdNo} onChange={(event) => setBillForm({ ...billForm, patientIdNo: event.target.value.toUpperCase() })} /></label>
                  <label><span>门诊 / 住院号</span><input value={billForm.visitNo} onChange={(event) => setBillForm({ ...billForm, visitNo: event.target.value })} /></label>
                  <label><span>医疗机构 <b>*</b></span><input value={billForm.institution} onChange={(event) => setBillForm({ ...billForm, institution: event.target.value })} placeholder="请输入医院或药店名称" /></label>
                  <label><span>就诊科室</span><input value={billForm.department} onChange={(event) => setBillForm({ ...billForm, department: event.target.value })} /></label>
                  <label><span>收费日期 <b>*</b></span><AppDatePicker ariaLabel="收费日期" disabled={calculationDataLocked} value={billForm.billDate} onChange={(billDate) => setBillForm({ ...billForm, billDate })} /></label>
                  <label><span>入院日期</span><AppDatePicker ariaLabel="入院日期" disabled={calculationDataLocked} value={billForm.admissionDate} onChange={(admissionDate) => setBillForm({ ...billForm, admissionDate })} /></label>
                  <label><span>出院日期</span><AppDatePicker ariaLabel="出院日期" disabled={calculationDataLocked} value={billForm.dischargeDate} onChange={(dischargeDate) => setBillForm({ ...billForm, dischargeDate })} /></label>
                  <label className="entry-wide"><span>主要诊断</span><input value={billForm.diagnosis} onChange={(event) => setBillForm({ ...billForm, diagnosis: event.target.value })} placeholder="疾病或诊断名称" /></label>
                  <label><span>收费员</span><input value={billForm.cashier} onChange={(event) => setBillForm({ ...billForm, cashier: event.target.value })} /></label>

                  <div className="entry-form-section-title">医保结算信息</div>
                  <label className="entry-wide"><span>医保类型</span><AppSelect ariaLabel="医保类型" disabled={calculationDataLocked} value={billForm.medicalInsuranceType} options={activeMedicalInsuranceTypeOptions} onChange={(medicalInsuranceType) => setBillForm({ ...billForm, medicalInsuranceType })} /></label>
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
                </fieldset>
                <div className="entry-form-actions">
                  <label className="entry-bind-current-image"><input type="checkbox" checked={bindBillCurrentImage} disabled={calculationDataLocked || !currentAttachmentId} onChange={(event) => setBindBillCurrentImage(event.target.checked)} /><span>绑定当前影像件</span></label>
                  {calculationDataLocked ? <button type="button" className="secondary-button" onClick={() => { setEditingBillId(""); setBillFormOpen(false); }}>收起详情</button> : editingBillId ? <button type="button" className="secondary-button" onClick={() => {
                    const insuredParty = selectedCase.parties.find((party) => party.role === "insured");
                    setEditingBillId("");
                    setBillForm(emptyBillForm(insuredParty?.name ?? "", insuredParty?.idNo ?? ""));
                    setBindBillCurrentImage(false);
                    setBillFormOpen(false);
                  }}>取消编辑</button> : null}
                  {!calculationDataLocked && !editingBillId ? <button type="button" className="secondary-button" onClick={() => setBillFormOpen(false)}>取消</button> : null}
                  {!calculationDataLocked ? <button type="button" onClick={() => void addBill()}>{editingBillId ? "更新账单" : "保存账单"}</button> : null}
                </div>
              </section> : null}
            </>
          )}

          {activeTab === "event" && (
            <section className="panel claim-form-panel claim-event-panel" ref={eventFormSectionRef}>
              <div className="panel-title-row">
                <div><div className="section-title">事件信息</div><small className="muted">{calculationDataLocked ? "显示当前被保人的全部事件；理算完成后只读" : "显示当前被保人的全部事件；可点击编辑"}</small></div>
                {!calculationDataLocked ? <button type="button" onClick={startNewEvent}>新增事件</button> : null}
              </div>
              <div className="claim-event-filters">
                <input aria-label="事件关键词筛选" value={eventKeyword} onChange={(event) => setEventKeyword(event.target.value)} />
                <AppSelect ariaLabel="事件类型筛选" value={eventTypeFilter} options={eventFilterOptions} onChange={setEventTypeFilter} />
                <AppDatePicker ariaLabel="事件日期筛选" value={eventDateFilter} onChange={setEventDateFilter} />
                <button type="button" className="secondary-button" onClick={() => { setEventKeyword(""); setEventTypeFilter("all"); setEventDateFilter(""); }}>清空筛选</button>
              </div>
              <div className="table-wrapper claim-event-list"><table><thead><tr><th>关联</th><th>事件号</th><th>被保人姓名</th><th>类型</th><th>发生日期</th><th>行政区</th><th>医院</th><th>诊断</th><th>事件经过</th><th className="entry-event-operation-column">操作</th></tr></thead><tbody>
                {filteredEvents.length ? filteredEvents.map((item) => <tr key={item.id} className={item.id === selectedCase.eventId ? "active-row" : ""}>
                  <td><button type="button" className={item.id === selectedCase.eventId ? "event-associated-button" : "secondary-button"} disabled={calculationDataLocked} onClick={() => void associateEvent(item)}>{item.id === selectedCase.eventId ? "已关联" : "关联"}</button></td>
                  <td><strong>{item.eventNo}</strong></td>
                  <td>{insured?.name ?? "-"}</td>
                  <td>{activeEventTypeOptions.find((option) => option.value === item.eventType)?.label ?? item.eventType}</td>
                  <td>{item.occurredDate}</td>
                  <td>{item.administrativeArea || "-"}</td>
                  <td>{item.hospitalName || "-"}</td>
                  <td>{item.diagnosis || "-"}</td>
                  <td>{item.description}</td>
                  <td className="entry-event-operation-column"><button type="button" className="action-link" onClick={() => editEvent(item)}>{calculationDataLocked ? "查看" : "编辑"}</button></td>
                </tr>) : <tr><td className="config-empty-cell" colSpan={10}>没有符合筛选条件的事件。</td></tr>}
              </tbody></table></div>
              {eventFormOpen ? <div className="claim-event-editor">
                <div className="panel-title-row"><div className="section-title">{calculationDataLocked ? "查看事件" : editingEventId ? "编辑事件" : "新增事件"}</div><button type="button" className="secondary-button" onClick={() => { setEditingEventId(""); setEventFormOpen(false); setEventForm(emptyCalculationEventForm()); }}>{calculationDataLocked ? "收起详情" : `取消${editingEventId ? "编辑" : "新增"}`}</button></div>
                <fieldset className="claim-form-grid" disabled={calculationDataLocked}>
                  <label><span>事件类型 <b>*</b></span><AppSelect ariaLabel="事件类型" disabled={calculationDataLocked} value={eventForm.eventType} options={activeEventTypeOptions} onChange={(eventType) => setEventForm((current) => ({ ...current, eventType }))} /></label>
                  <label><span>事件发生日期 <b>*</b></span><AppDatePicker ariaLabel="事件发生日期" disabled={calculationDataLocked} value={eventForm.occurredDate} onChange={(occurredDate) => setEventForm((current) => ({ ...current, occurredDate }))} /></label>
                  <label className="claim-wide-field"><span>发生地点（省/市/区县）</span><AppCombobox ariaLabel="发生地点" disabled={calculationDataLocked} value={eventForm.administrativeArea} options={eventAreaOptions} onChange={(administrativeArea) => setEventForm((current) => ({ ...current, administrativeArea }))} placeholder="" /></label>
                  <label className="claim-wide-field"><span>详细地点</span><input value={eventForm.detailedAddress} onChange={(event) => setEventForm((current) => ({ ...current, detailedAddress: event.target.value }))} /></label>
                  <label><span>就诊医院</span><input value={eventForm.hospitalName} onChange={(event) => setEventForm((current) => ({ ...current, hospitalName: event.target.value }))} /></label>
                  <label><span>诊断</span><input value={eventForm.diagnosis} onChange={(event) => setEventForm((current) => ({ ...current, diagnosis: event.target.value }))} /></label>
                  <label className="claim-wide-field"><span>事件经过 <b>*</b></span><textarea value={eventForm.description} onChange={(event) => setEventForm((current) => ({ ...current, description: event.target.value }))} /></label>
                </fieldset>
                {!calculationDataLocked ? <div className="claim-event-editor-actions"><button type="button" onClick={() => void addEvent()}>{editingEventId ? "保存事件修改" : "保存事件"}</button></div> : null}
              </div> : null}
            </section>
          )}

          {activeTab === "disease" && (
            <>
              <section className="panel entry-list-panel">
                <div className="panel-title-row"><div className="section-title">已录入疾病</div><span className="muted">共 {diseases.length} 条</span></div>
                <div className="table-wrapper"><table><thead><tr><th>疾病名称</th><th>ICD 编码</th><th>确诊日期</th><th>确诊医院</th><th>诊断说明</th>{!calculationDataLocked ? <th>操作</th> : null}</tr></thead><tbody>{diseases.length ? diseases.map((item) => <tr key={item.id}><td>{item.diseaseName}</td><td>{item.icdCode || "-"}</td><td>{item.diagnosisDate}</td><td>{item.hospital}</td><td>{item.note || "-"}</td>{!calculationDataLocked ? <td><button className="action-link" onClick={() => editDisease(item)}>编辑</button><button className="danger-link" onClick={() => void removeDiseaseEntry(item.id)}>删除</button></td> : null}</tr>) : <tr><td className="config-empty-cell" colSpan={calculationDataLocked ? 5 : 6}>{calculationDataLocked ? "暂无疾病。" : "暂无疾病，请点击下方“新增疾病”。"}</td></tr>}</tbody></table></div>
                {!calculationDataLocked ? <div className="entry-list-add-row"><button type="button" onClick={startNewDisease}><b>＋</b> 新增疾病</button></div> : null}
              </section>
              {!calculationDataLocked && diseaseFormOpen ? <section className="panel" ref={diseaseFormSectionRef}>
                <div className="section-title">录入疾病</div>
                <div className="entry-form-grid">
                  <label><span>疾病名称 <b>*</b></span><input value={diseaseForm.diseaseName} onChange={(event) => setDiseaseForm({ ...diseaseForm, diseaseName: event.target.value })} placeholder="请输入疾病或诊断名称" /></label>
                  <label><span>ICD 编码</span><input value={diseaseForm.icdCode} onChange={(event) => setDiseaseForm({ ...diseaseForm, icdCode: event.target.value.toUpperCase() })} placeholder="例如 J18.9" /></label>
                  <label><span>确诊日期 <b>*</b></span><AppDatePicker ariaLabel="确诊日期" value={diseaseForm.diagnosisDate} onChange={(diagnosisDate) => setDiseaseForm({ ...diseaseForm, diagnosisDate })} /></label>
                  <label><span>确诊医院 <b>*</b></span><input value={diseaseForm.hospital} onChange={(event) => setDiseaseForm({ ...diseaseForm, hospital: event.target.value })} placeholder="请输入确诊医院" /></label>
                  <label className="entry-full"><span>诊断说明</span><textarea value={diseaseForm.note} onChange={(event) => setDiseaseForm({ ...diseaseForm, note: event.target.value })} placeholder="可补充症状、检查结果或诊断说明" /></label>
                </div>
                <div className="entry-form-actions">
                  <button type="button" className="secondary-button" onClick={() => {
                    setEditingDiseaseId("");
                    setDiseaseFormOpen(false);
                  }}>取消</button>
                  <button type="button" onClick={() => void addDisease()}>{editingDiseaseId ? "更新疾病" : "保存疾病"}</button>
                </div>
              </section> : null}
            </>
          )}
        </div>
      </div>
      </div>
      </div>
    </div>
  );
});

export default ClaimEntryCalculationPage;
