from __future__ import annotations

import json
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .claims_engine import evaluate_claim
from .llm_client import generate_claim_brief
from .repository import ClaimRepository
from .serializers import build_claim_list_item

ROOT = Path(__file__).resolve().parent.parent
REPOSITORY = ClaimRepository(ROOT / "data" / "claims.db", ROOT / "mock", ROOT / "rules")


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True


class ClaimAgentHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == "/api/health":
            self._send_json({"status": "ok"})
            return

        if parsed.path == "/api/demo":
            self._send_json(_build_claim_payload(REPOSITORY.get_demo_claim(), include_summary=True))
            return

        if parsed.path == "/api/claims":
            query = parse_qs(parsed.query)
            if "claimId" in query:
                claim_id = query.get("claimId", [REPOSITORY.default_claim_id])[0]
                include_summary = query.get("includeSummary", ["0"])[0] == "1"
                self._send_json(
                    _build_claim_payload(
                        REPOSITORY.get_claim(claim_id),
                        include_summary=include_summary,
                    )
                )
                return

            claims = []
            rule = REPOSITORY.get_default_rule()
            for claim in REPOSITORY.list_claims():
                evaluation = evaluate_claim(claim, rule)
                claims.append(build_claim_list_item(claim, evaluation))
            self._send_json({"items": claims})
            return

        if parsed.path == "/api/claims/summary":
            query = parse_qs(parsed.query)
            claim_id = query.get("claimId", [REPOSITORY.default_claim_id])[0]
            claim = REPOSITORY.get_claim(claim_id)
            rule = REPOSITORY.get_default_rule()
            evaluation = evaluate_claim(claim, rule)
            summary = generate_claim_brief(claim, rule, evaluation)
            self._send_json({"claimId": claim_id, "summary": summary})
            return

        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)

        if parsed.path == "/api/evaluate":
            payload = self._read_json()
            claim = payload.get("claim") or REPOSITORY.get_demo_claim()
            rule = payload.get("rule") or REPOSITORY.get_default_rule()
            evaluation = evaluate_claim(claim, rule)
            summary = generate_claim_brief(claim, rule, evaluation)
            self._send_json(
                {
                    "claim": claim,
                    "rule": rule,
                    "evaluation": evaluation,
                    "summary": summary,
                }
            )
            return

        if parsed.path == "/api/claims/action":
            payload = self._read_json()
            claim_id = payload["claimId"]
            action = payload["action"]
            note = payload.get("note", "")
            claim = REPOSITORY.get_claim(claim_id)
            claim["status"] = _map_status(action)
            REPOSITORY.save_claim(claim)
            REPOSITORY.record_action(claim_id, action, note or _default_note(action))
            self._send_json(_build_claim_payload(claim, include_summary=True))
            return

        self._send_json({"error": "Not found"}, status=HTTPStatus.NOT_FOUND)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length > 0 else b"{}"
        return json.loads(body.decode("utf-8"))

    def _send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def run(host: str = "127.0.0.1", port: int = 8000) -> None:
    REPOSITORY.bootstrap()
    try:
        server = ReusableThreadingHTTPServer((host, port), ClaimAgentHandler)
    except OSError as error:
        if error.errno == 48:
            raise OSError(
                48,
                (
                    f"Address already in use: http://{host}:{port}. "
                    f"Stop the existing process or run with another port, for example "
                    f"`PORT=8001 python3 app.py`."
                ),
            ) from error
        raise

    print(f"Health claim agent running at http://{host}:{port}")
    server.serve_forever()


def _build_claim_payload(claim: dict, include_summary: bool = False) -> dict:
    rule = REPOSITORY.get_default_rule()
    evaluation = evaluate_claim(claim, rule)
    actions = REPOSITORY.list_actions(claim["claimId"])
    summary = (
        generate_claim_brief(claim, rule, evaluation)
        if include_summary
        else {"source": "pending", "text": "摘要生成中..."}
    )
    return {
        "claim": claim,
        "rule": rule,
        "evaluation": evaluation,
        "summary": summary,
        "actions": actions,
    }


def _map_status(action: str) -> str:
    mapping = {
        "approve": "approved",
        "reject": "rejected",
        "escalate": "pending_senior_review",
        "reopen": "accepted",
    }
    return mapping.get(action, "accepted")


def _default_note(action: str) -> str:
    notes = {
        "approve": "案件已进入通过状态，等待结案。",
        "reject": "案件被驳回，等待拒赔说明。",
        "escalate": "案件已升级至高级审批或风控复核。",
        "reopen": "案件已重新打开，回到理算阶段。",
    }
    return notes.get(action, "系统已记录该动作。")
