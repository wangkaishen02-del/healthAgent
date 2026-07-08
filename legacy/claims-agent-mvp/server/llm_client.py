from __future__ import annotations

import json
import os
from urllib.error import URLError
from urllib.request import Request, urlopen

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/chat")
MODEL = os.getenv("OLLAMA_MODEL", "qwen3:8b")
TIMEOUT_SECONDS = int(os.getenv("OLLAMA_TIMEOUT_SECONDS", "90"))


def generate_claim_brief(claim: dict, rule: dict, evaluation: dict) -> dict:
    prompt = _build_prompt(claim, rule, evaluation)
    payload = {
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
    }

    request = Request(
        OLLAMA_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    fallback_reason = "unknown"
    try:
        with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            body = json.loads(response.read().decode("utf-8"))
            text = body.get("message", {}).get("content", "").strip()
            if text:
                return {"source": "ollama", "text": text}
            fallback_reason = "empty_response"
    except (URLError, TimeoutError, OSError, json.JSONDecodeError) as error:
        fallback_reason = f"{type(error).__name__}: {error}"

    return {
        "source": "fallback",
        "reason": fallback_reason,
        "text": _fallback_summary(claim, evaluation),
    }


def _build_prompt(claim: dict, rule: dict, evaluation: dict) -> str:
    return f"""
你是健康险理赔助手。
请用简洁专业中文输出三段内容，每段 2 句以内：
1. 案件摘要
2. 审批关注点
3. 结论建议

案件信息：
- 理赔号：{claim["claimId"]}
- 被保险人：{claim["insured"]["name"]}
- 险种：{claim["claimType"]}
- 医院：{claim["incident"]["hospitalName"]}
- 诊断：{",".join(claim["incident"]["diagnosis"])}
- 总费用：{claim["expense"]["totalAmount"]}
- 医保已报销：{claim["expense"]["socialInsurancePaid"]}
- 自费金额：{claim["expense"]["selfPaidAmount"]}
- 规则产品：{rule["productName"]}
- 免赔额：{evaluation["deductible"]}
- 剔除金额：{evaluation["excludedAmount"]}
- 预计赔付：{evaluation["payableAmount"]}
- 建议动作：{evaluation["suggestedAction"]}
- 风险标签：{",".join(evaluation["riskFlags"])}

要求：
- 不要展开通用保险知识
- 只围绕当前案件
- 用项目符号或短段落输出
""".strip()


def _fallback_summary(claim: dict, evaluation: dict) -> str:
    return (
        f"案件摘要：{claim['insured']['name']} 本次因 {claim['incident']['diagnosis'][0]} 住院，"
        f"系统试算预计赔付 {evaluation['payableAmount']:.2f} 元。\n"
        f"审批关注点：重点确认剔除费用与条款适配性，当前风险标签为 {', '.join(evaluation['riskFlags'])}。\n"
        "结论建议：在人工确认剔除项后，按系统试算结果推进审批。"
    )
