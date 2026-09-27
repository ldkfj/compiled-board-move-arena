import json


def test_current_runtime_schema_and_pickling(direct_vm, direct_deploy, direct_alice):
    direct_vm.check_pickling = True
    direct_vm._live_llm_handler = lambda _data: {"ok": json.dumps({"v": 1, "supported": True, "cells": "D" * 81})}
    contract = direct_deploy("probes/contract_feasibility.py")
    contract.exercise(1, direct_alice, "Move one square orthogonally")
    assert len(direct_vm._captured_validators) == 1
    assert direct_vm.run_validator() is True
