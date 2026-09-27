# v0.3.0
# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }

import json

import genlayer as gl


def _compile(rule: str):
    task = "Classify all 81 ordered board moves. Return exactly JSON with v, supported, cells."

    def leader():
        raw = gl.nondet.exec_prompt(task + "\n" + rule)
        value = json.loads(raw) if isinstance(raw, str) else raw
        if set(value) != {"v", "supported", "cells"}:
            raise gl.vm.UserError("BAD_RESULT")
        return value

    def validator(proposed):
        if not isinstance(proposed, gl.vm.Return):
            return False
        try:
            return proposed.calldata == leader()
        except Exception:
            return False

    return gl.vm.run_nondet(leader, validator)


class BoardArenaFeasibility(gl.contract.Contract):
    count: gl.u256
    cases: gl.storage.TreeMap[gl.u256, str]
    nonce_index: gl.storage.TreeMap[str, gl.u256]
    actor_index: gl.storage.TreeMap[str, str]
    child_index: gl.storage.TreeMap[gl.u256, str]
    version_index: gl.storage.TreeMap[gl.u256, gl.u256]
    history: gl.storage.TreeMap[str, str]

    def __init__(self):
        self.count = gl.u256(0)

    @gl.public.view
    def inspect(self, case_id: gl.u256, actor: gl.Address, label: str) -> str:
        return json.dumps([str(case_id), str(actor), label])

    @gl.public.write
    def exercise(self, case_id: gl.u256, actor: gl.Address, rule: str) -> None:
        self.cases[case_id] = str(_compile(rule))
