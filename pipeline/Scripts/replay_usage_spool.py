"""
Replay LLM usage rows the database never accepted.

`usage_tracker` spools any row the internal API refused (app redeploying, DB
blip, network) to `Outputs/usage_spool.jsonl`. Nothing replayed them, so that
spend simply never appeared in `llm_usage` — about $20 of August's real cost.

Every row carries the id it was first sent with and the server discards a
duplicate id, so replaying is safe to repeat and safe to interrupt.

Usage:
    python replay_usage_spool.py            # replay, keep what still fails
    python replay_usage_spool.py --dry-run  # just report what is pending
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from usage_tracker import USAGE_SPOOL_FILE, _insert_remote, _write_lines_atomic


def _load(path: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    rows = []
    with open(path) as f:
        for n, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                print(f"[replay] skipping unparseable line {n}", flush=True)
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="report without sending")
    ap.add_argument("--spool", default=USAGE_SPOOL_FILE, help="spool file to replay")
    args = ap.parse_args()

    rows = _load(args.spool)
    if not rows:
        print(f"[replay] nothing pending in {args.spool}")
        return 0

    total = sum(float(r.get("cost_usd") or 0) for r in rows)
    print(f"[replay] {len(rows)} pending rows, ${total:.4f} unrecorded")
    if args.dry_run:
        return 0

    failed = []
    sent_cost = 0.0
    for row in rows:
        if _insert_remote(row):
            sent_cost += float(row.get("cost_usd") or 0)
        else:
            failed.append(row)

    # Rewrite the spool with only what is still outstanding.
    _write_lines_atomic(args.spool, [json.dumps(r) for r in failed])

    print(f"[replay] recorded {len(rows) - len(failed)} rows (${sent_cost:.4f})")
    if failed:
        print(f"[replay] {len(failed)} still pending — rerun once the app is reachable")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
