from __future__ import annotations

from datetime import date


def _parse_date(value: str) -> date:
    return date.fromisoformat(value)


def evaluate_claim(claim: dict, rule: dict) -> dict:
    coverage = rule["coverage"]
    incident = claim["incident"]
    expense = claim["expense"]

    admission_date = _parse_date(incident["admissionDate"])
    policy_start = _parse_date(claim.get("policyEffectiveDate", "2026-01-01"))
    waiting_period_days = coverage["waitingPeriodDays"]
    days_since_effective = (admission_date - policy_start).days
    waiting_period_passed = days_since_effective >= waiting_period_days

    excluded_amount = sum(
        item["amount"] for item in expense.get("suspectedExcludedItems", [])
    )
    deductible = coverage["deductible"]
    reimbursement_rate = coverage["reimbursementRate"]
    self_paid_amount = expense["selfPaidAmount"]
    eligible_base = max(self_paid_amount - excluded_amount - deductible, 0)
    payable_amount = round(eligible_base * reimbursement_rate, 2)
    within_limit = payable_amount <= coverage["annualLimit"]

    risk_flags = list(claim.get("riskFlags", []))
    if excluded_amount > 0:
        risk_flags.append("manual_exclusion_review")

    suggested_action = "approve"
    if not waiting_period_passed:
        suggested_action = "reject"
        risk_flags.append("waiting_period")
    elif payable_amount >= rule["approvalRouting"]["manualReviewThreshold"]:
        suggested_action = "escalate"
        risk_flags.append("high_amount")
    elif "suspected_fraud" in risk_flags:
        suggested_action = "escalate"

    timeline = [
        {
            "title": "受理完成",
            "body": "单证已完成结构化抽取，可进入理算。",
        },
        {
            "title": "规则校验",
            "body": f"等待期校验结果：{'通过' if waiting_period_passed else '未通过'}，距保单生效 {days_since_effective} 天。",
        },
        {
            "title": "理算试算",
            "body": f"自费金额 {self_paid_amount:.2f}，剔除金额 {excluded_amount:.2f}，免赔额 {deductible:.2f}，赔付比例 {int(reimbursement_rate * 100)}%。",
        },
    ]

    return {
        "waitingPeriodPassed": waiting_period_passed,
        "daysSincePolicyEffective": days_since_effective,
        "excludedAmount": round(excluded_amount, 2),
        "deductible": deductible,
        "eligibleBase": round(eligible_base, 2),
        "reimbursementRate": reimbursement_rate,
        "payableAmount": payable_amount,
        "withinAnnualLimit": within_limit,
        "suggestedAction": suggested_action,
        "riskFlags": risk_flags,
        "timeline": timeline,
        "decision": _build_decision(claim, payable_amount, suggested_action, waiting_period_passed),
    }


def _build_decision(
    claim: dict,
    payable_amount: float,
    suggested_action: str,
    waiting_period_passed: bool,
) -> dict:
    insured_name = claim["insured"]["name"]

    if not waiting_period_passed:
        return {
            "title": "建议拒赔",
            "body": f"{insured_name} 的本次住院发生在等待期内，建议拒赔并生成条款说明。",
        }

    if suggested_action == "escalate":
        return {
            "title": "建议升级人工复核",
            "body": f"预计赔付金额 {payable_amount:.2f} 元，建议提交高级审批或风控复核。",
        }

    return {
        "title": f"建议赔付 {payable_amount:.2f} 元",
        "body": "规则试算已完成，当前案件适合进入人工审批确认后结案。",
    }
