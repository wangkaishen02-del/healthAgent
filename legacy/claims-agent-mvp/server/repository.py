from __future__ import annotations

import json
import sqlite3
from pathlib import Path


class ClaimRepository:
    def __init__(self, db_path: Path, mock_dir: Path, rules_dir: Path) -> None:
        self.db_path = db_path
        self.mock_dir = mock_dir
        self.rules_dir = rules_dir
        self.default_claim_id = "CLM-20260706-0001"

    def bootstrap(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS claims (
                    claim_id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS rules (
                    rule_set_id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS claim_actions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    claim_id TEXT NOT NULL,
                    action TEXT NOT NULL,
                    note TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.commit()

        self._seed_claims()
        self._seed_rule_if_missing()

    def list_claims(self) -> list[dict]:
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                "SELECT payload FROM claims ORDER BY claim_id"
            ).fetchall()
        return [json.loads(row[0]) for row in rows]

    def get_claim(self, claim_id: str) -> dict:
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT payload FROM claims WHERE claim_id = ?",
                (claim_id,),
            ).fetchone()
        if not row:
            raise KeyError(f"Claim not found: {claim_id}")
        return json.loads(row[0])

    def get_demo_claim(self) -> dict:
        return self.get_claim(self.default_claim_id)

    def save_claim(self, claim: dict) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO claims (claim_id, payload)
                VALUES (?, ?)
                ON CONFLICT(claim_id) DO UPDATE SET payload = excluded.payload
                """,
                (claim["claimId"], json.dumps(claim, ensure_ascii=False)),
            )
            conn.commit()

    def get_default_rule(self) -> dict:
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute("SELECT payload FROM rules LIMIT 1").fetchone()
        if not row:
            raise KeyError("Default rule not found")
        return json.loads(row[0])

    def record_action(self, claim_id: str, action: str, note: str) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO claim_actions (claim_id, action, note)
                VALUES (?, ?, ?)
                """,
                (claim_id, action, note),
            )
            conn.commit()

    def list_actions(self, claim_id: str) -> list[dict]:
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                """
                SELECT action, note, created_at
                FROM claim_actions
                WHERE claim_id = ?
                ORDER BY id DESC
                """,
                (claim_id,),
            ).fetchall()
        return [
            {"action": row[0], "note": row[1], "createdAt": row[2]}
            for row in rows
        ]

    def _seed_claims(self) -> None:
        for file_path in sorted(self.mock_dir.glob("*.json")):
            claim = json.loads(file_path.read_text(encoding="utf-8"))
            claim.setdefault("policyEffectiveDate", "2026-01-01")
            existing = None
            try:
                existing = self.get_claim(claim["claimId"])
            except KeyError:
                existing = None
            if not existing:
                self.save_claim(claim)

    def _seed_rule_if_missing(self) -> None:
        rule = json.loads(
            (self.rules_dir / "basic-hospitalization-rule.json").read_text(encoding="utf-8")
        )
        with sqlite3.connect(self.db_path) as conn:
            exists = conn.execute(
                "SELECT 1 FROM rules WHERE rule_set_id = ?",
                (rule["ruleSetId"],),
            ).fetchone()
            if not exists:
                conn.execute(
                    "INSERT INTO rules (rule_set_id, payload) VALUES (?, ?)",
                    (rule["ruleSetId"], json.dumps(rule, ensure_ascii=False)),
                )
                conn.commit()
