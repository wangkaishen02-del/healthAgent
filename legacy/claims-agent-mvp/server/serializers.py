from __future__ import annotations


def build_claim_list_item(claim: dict, evaluation: dict) -> dict:
    return {
        "claimId": claim["claimId"],
        "insuredName": claim["insured"]["name"],
        "claimType": claim["claimType"],
        "diagnosis": "、".join(claim["incident"]["diagnosis"]),
        "status": claim.get("status", "accepted"),
        "hospitalName": claim["incident"]["hospitalName"],
        "payableAmount": evaluation["payableAmount"],
        "suggestedAction": evaluation["suggestedAction"],
        "riskFlags": evaluation["riskFlags"],
    }
