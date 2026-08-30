import type { BillAttachmentChangeDecision } from "./ClaimEntryCalculationModel";

type Props = {
  attachmentChange?: { previousName: string; nextName?: string } | null;
  calculationRollbackOpen: boolean;
  caseRollbackOpen: boolean;
  withdrawOpen: boolean;
  caseNo: string;
  onAttachmentDecision: (decision: BillAttachmentChangeDecision) => void;
  onCalculationRollback: () => void | Promise<unknown>;
  onCloseCalculationRollback: () => void;
  onCaseRollback: () => void | Promise<unknown>;
  onCloseCaseRollback: () => void;
  onWithdraw: () => void | Promise<unknown>;
  onCloseWithdraw: () => void;
};

export default function ClaimWorkflowDialogs({
  attachmentChange,
  calculationRollbackOpen,
  caseRollbackOpen,
  withdrawOpen,
  caseNo,
  onAttachmentDecision,
  onCalculationRollback,
  onCloseCalculationRollback,
  onCaseRollback,
  onCloseCaseRollback,
  onWithdraw,
  onCloseWithdraw,
}: Props) {
  return <>
    {attachmentChange ? <div className="bill-attachment-change-overlay">
      <div className="bill-attachment-change-dialog" role="dialog" aria-modal="true" aria-labelledby="bill-attachment-change-title">
        <div className="section-title" id="bill-attachment-change-title">账单绑定影像件发生变化</div>
        <p>
          当前绑定：<strong>{attachmentChange.previousName}</strong>
          <br />
          保存后：<strong>{attachmentChange.nextName ?? "不再绑定影像件"}</strong>
        </p>
        <div className="bill-attachment-change-actions">
          <button type="button" onClick={() => onAttachmentDecision("change")}>确定</button>
          <button type="button" className="secondary-button" onClick={() => onAttachmentDecision("cancel")}>取消</button>
          <button type="button" className="secondary-button" onClick={() => onAttachmentDecision("keep")}>不修改绑定</button>
        </div>
      </div>
    </div> : null}
    {calculationRollbackOpen ? <div className="bill-attachment-change-overlay">
      <div className="bill-attachment-change-dialog" role="dialog" aria-modal="true" aria-labelledby="calculation-rollback-title">
        <div className="section-title" id="calculation-rollback-title">确认理算回退</div>
        <p>回退后将删除本案的理算过程、账单责任结果和案件结果，同时删除本案累计记录并冲回台账当前值。</p>
        <div className="bill-attachment-change-actions">
          <button type="button" className="danger-button" onClick={() => void onCalculationRollback()}>确认回退</button>
          <button type="button" className="secondary-button" onClick={onCloseCalculationRollback}>取消</button>
        </div>
      </div>
    </div> : null}
    {caseRollbackOpen ? <div className="bill-attachment-change-overlay">
      <div className="bill-attachment-change-dialog" role="dialog" aria-modal="true" aria-labelledby="case-rollback-title">
        <div className="section-title" id="case-rollback-title">确认案件回退</div>
        <p>案件将直接回到上一状态，并退给最近一次提交到当前状态的操作人。</p>
        <div className="bill-attachment-change-actions">
          <button type="button" className="danger-button" onClick={() => void onCaseRollback()}>确认回退</button>
          <button type="button" className="secondary-button" onClick={onCloseCaseRollback}>取消</button>
        </div>
      </div>
    </div> : null}
    {withdrawOpen ? <div className="bill-attachment-change-overlay">
      <div className="bill-attachment-change-dialog" role="dialog" aria-modal="true" aria-labelledby="calculation-withdraw-title">
        <div className="section-title" id="calculation-withdraw-title">确认撤件</div>
        <p>确定撤销案件 <strong>{caseNo}</strong> 吗？撤件后案件将退出当前处理流程。</p>
        <div className="bill-attachment-change-actions">
          <button type="button" className="danger-button" onClick={() => void onWithdraw()}>确认撤件</button>
          <button type="button" className="secondary-button" onClick={onCloseWithdraw}>取消</button>
        </div>
      </div>
    </div> : null}
  </>;
}
