# v0.1.0
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import json

from genlayer import *


def _compile(rule: str):
    task = "Classify all 81 ordered board moves. Return exactly JSON with v, supported, cells."

    def leader():
        raw = gl.nondet.exec_prompt(task + "\n" + rule, response_format="json")
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

    return gl.vm.run_nondet_unsafe(leader, validator)


class BoardArenaFeasibility(gl.Contract):
    count: u256
    cases: TreeMap[u256, str]
    nonce_index: TreeMap[str, u256]
    actor_index: TreeMap[str, str]
    child_index: TreeMap[u256, str]
    version_index: TreeMap[u256, u256]
    history: TreeMap[str, str]

    def __init__(self):
        self.count = u256(0)

    @gl.public.view
    def inspect(self, case_id: u256, actor: Address, label: str) -> str:
        return json.dumps([str(case_id), str(actor), label])

    @gl.public.write
    def exercise(self, case_id: u256, actor: Address, rule: str) -> None:
        self.cases[case_id] = str(_compile(rule))
