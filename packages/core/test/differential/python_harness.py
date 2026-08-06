"""Differential test harness: calls the real, installed Python reference implementation
package (v0.9.0) so packages/core's TS ports can be checked byte-for-byte against the
Python implementation they were ported from (design.md §9 checkpoint 3 / §10).

This is a private reference implementation this repo was ported from, not published
anywhere the public can install it -- see docs/design.md §9/§10 and the README's
"differential tests" note for what this means for a fresh clone (they skip gracefully
when the package below isn't importable, per LANE_SKIP_DIFFERENTIAL_TESTS).

Usage: `echo '{"fn": "...", "args": [...]}' | python3 python_harness.py`
Prints `{"result": <value>}` or `{"error": "<message>"}` to stdout as JSON.

Only a fixed allow-list of pure reference-implementation functions is exposed -- this
harness is a test fixture, not a general RPC bridge into the Python package.
"""

import json
import sys

# The one place in this codebase that must reference the actual private package name --
# there is no way to test parity against it without importing it by its real name.
from qureo_lane import orchestrator as o
from qureo_lane import validate as v


def _compute_ledger_entry_id(lane_id, phase, source, pricing_version):
    return o.compute_ledger_entry_id(lane_id, phase, source, pricing_version)


def _derive_confidence(source, scope):
    return o.derive_confidence(source, scope)


def _classify_data_state(import_exit_ok, had_events, total_tokens):
    return o.classify_data_state(import_exit_ok, had_events, total_tokens)


def _derive_included_in_kpi(entry, ledger):
    return o.derive_included_in_kpi(entry, ledger)


def _recompute_included_in_kpi(ledger):
    return o.recompute_included_in_kpi(ledger)


def _is_forward_transition(current, target):
    return o.is_forward_transition(current, target)


def _apply_done_overlay(state, overlay):
    return o.apply_done_overlay(state, overlay)


def _validate_no_personal_dimensions(payload):
    return o.validate_no_personal_dimensions(payload)


def _derive_cost_credits(cost_usd, source):
    return o.derive_cost_credits(cost_usd, source)


def _normalize_criterion(text):
    return v.normalize_criterion(text)


FUNCTIONS = {
    "compute_ledger_entry_id": _compute_ledger_entry_id,
    "derive_confidence": _derive_confidence,
    "classify_data_state": _classify_data_state,
    "derive_included_in_kpi": _derive_included_in_kpi,
    "recompute_included_in_kpi": _recompute_included_in_kpi,
    "is_forward_transition": _is_forward_transition,
    "apply_done_overlay": _apply_done_overlay,
    "validate_no_personal_dimensions": _validate_no_personal_dimensions,
    "derive_cost_credits": _derive_cost_credits,
    "normalize_criterion": _normalize_criterion,
}


def main():
    request = json.loads(sys.stdin.read())
    fn_name = request["fn"]
    args = request.get("args", [])
    if fn_name not in FUNCTIONS:
        print(json.dumps({"error": f"unknown fn: {fn_name}"}))
        return
    try:
        result = FUNCTIONS[fn_name](*args)
        print(json.dumps({"result": result}))
    except Exception as exc:  # noqa: BLE001 - test harness, surface any failure as JSON
        print(json.dumps({"error": f"{type(exc).__name__}: {exc}"}))


if __name__ == "__main__":
    main()
