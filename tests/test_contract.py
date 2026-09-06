import json

import pytest


RULE = "Move one square orthogonally; no diagonal moves."
NONCE = "00" * 16


def deploy(vm, direct_deploy):
    vm._chain_id = 61127
    vm.warp("2026-09-07T00:00:00Z")
    return direct_deploy("contracts/main.py")


def record(contract, case_id=1):
    return json.loads(contract.get_case(case_id))


def address_text(value):
    return "0x" + bytes(value).hex() if isinstance(value, bytes) else str(value).lower()


def matrix_cells(edges):
    cells = ["D"] * 81
    for origin, target in edges:
        cells[9 * origin + target] = "A"
    return "".join(cells)


def create_frozen(vm, direct_deploy, alice, bob):
    contract = deploy(vm, direct_deploy)
    vm.sender = alice
    assert contract.create_arena(NONCE, bob, RULE) == 1
    contract.freeze_rule(1, 1)
    return contract


def test_create_freeze_idempotency_and_authority(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = deploy(direct_vm, direct_deploy)
    direct_vm.sender = direct_alice
    assert contract.create_arena(NONCE, direct_bob, RULE) == 1
    assert contract.create_arena(NONCE, direct_bob, RULE) == 1
    assert record(contract)["revision"] == "1"
    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert("UNAUTHORIZED"):
            contract.freeze_rule(1, 1)
    contract.freeze_rule(1, 1)
    frozen = record(contract)
    assert (frozen["phase"], frozen["revision"], frozen["base_locked"]) == ("FROZEN", "2", True)


def test_compile_join_and_capture_are_deterministic(direct_vm, direct_deploy, direct_alice, direct_bob):
    cells = matrix_cells([(0, 1), (1, 7), (8, 7), (7, 0)])
    direct_vm.mock_llm("Compile the frozen", {"v": 1, "supported": True, "cells": cells})
    direct_vm.check_pickling = True
    contract = create_frozen(direct_vm, direct_deploy, direct_alice, direct_bob)
    contract.compile_moves(1, 2)
    assert direct_vm.run_validator() is True
    compiled = record(contract)
    assert compiled["phase"] == "COMPILED"
    assert compiled["domain"]["matrix"][1] == "1"
    with direct_vm.prank(direct_bob):
        contract.join_arena(1, 3)
    before_calls = len(direct_vm._captured_validators)
    with direct_vm.prank(direct_alice):
        contract.move_piece(1, 0, 1, 0, 4)
    with direct_vm.prank(direct_bob):
        contract.move_piece(1, 8, 7, 1, 5)
    with direct_vm.prank(direct_alice):
        contract.move_piece(1, 1, 7, 2, 6)
    final = record(contract)
    assert (final["phase"], final["outcome"]) == ("DONE", "CAPTURE")
    assert final["domain"]["winner"] == address_text(direct_alice)
    assert len(direct_vm._captured_validators) == before_calls


@pytest.mark.parametrize("bad", ["D" * 80, "D" * 40 + "X" + "D" * 40, "A" + "D" * 80])
def test_malformed_compile_output_is_no_write(direct_vm, direct_deploy, direct_alice, direct_bob, bad):
    direct_vm.mock_llm("Compile the frozen", {"v": 1, "supported": True, "cells": bad})
    contract = create_frozen(direct_vm, direct_deploy, direct_alice, direct_bob)
    before = contract.get_case(1)
    with direct_vm.expect_revert("MALFORMED_RESULT"):
        contract.compile_moves(1, 2)
    assert contract.get_case(1) == before


def test_unknown_retry_exhaustion_and_cancel(direct_vm, direct_deploy, direct_alice, direct_bob):
    cells = list("D" * 81); cells[1] = "U"; cells[72 + 7] = "A"
    direct_vm.mock_llm("Compile the frozen", {"v": 1, "supported": True, "cells": "".join(cells)})
    contract = create_frozen(direct_vm, direct_deploy, direct_alice, direct_bob)
    contract.compile_moves(1, 2)
    assert record(contract)["phase"] == "UNRESOLVED"
    with direct_vm.expect_revert("TOO_SOON"):
        contract.retry_compile(1, 3)
    direct_vm.warp("2026-09-07T00:01:00Z"); contract.retry_compile(1, 3)
    direct_vm.warp("2026-09-07T00:02:00Z"); contract.retry_compile(1, 4)
    assert record(contract)["phase"] == "EXHAUSTED"
    contract.cancel_arena(1, 5)
    assert record(contract)["outcome"] == "CANCELLED"


def test_illegal_move_and_stale_guards_do_not_write(direct_vm, direct_deploy, direct_alice, direct_bob):
    cells = matrix_cells([(0, 1), (8, 7)])
    direct_vm.mock_llm("Compile the frozen", {"v": 1, "supported": True, "cells": cells})
    contract = create_frozen(direct_vm, direct_deploy, direct_alice, direct_bob)
    contract.compile_moves(1, 2)
    with direct_vm.prank(direct_bob): contract.join_arena(1, 3)
    before = contract.get_case(1)
    with direct_vm.prank(direct_alice):
        with direct_vm.expect_revert("STALE_PLY"): contract.move_piece(1, 0, 1, 1, 4)
        with direct_vm.expect_revert("ILLEGAL_MOVE"): contract.move_piece(1, 0, 2, 0, 4)
    assert contract.get_case(1) == before


def test_unsupported_never_opens_play(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.mock_llm("Compile the frozen", {"v": 1, "supported": False, "cells": "U" * 81})
    contract = create_frozen(direct_vm, direct_deploy, direct_alice, direct_bob)
    contract.compile_moves(1, 2)
    assert (record(contract)["phase"], record(contract)["outcome"]) == ("DONE", "UNSUPPORTED_RULE")


def test_unplayable_persists_matrix_for_inspection(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.mock_llm("Compile the frozen", {"v": 1, "supported": True, "cells": "D" * 81})
    contract = create_frozen(direct_vm, direct_deploy, direct_alice, direct_bob)
    contract.compile_moves(1, 2)
    unplayable = record(contract)
    assert (unplayable["phase"], unplayable["outcome"], len(unplayable["domain"]["matrix"])) == ("DONE", "UNPLAYABLE_RULE", 81)


def test_no_move_resign_lists_and_history(direct_vm, direct_deploy, direct_alice, direct_bob):
    cells = matrix_cells([(0, 1), (1, 2), (8, 7)])
    direct_vm.mock_llm("Compile the frozen", {"v": 1, "supported": True, "cells": cells})
    contract = create_frozen(direct_vm, direct_deploy, direct_alice, direct_bob)
    contract.compile_moves(1, 2)
    with direct_vm.prank(direct_bob): contract.join_arena(1, 3)
    with direct_vm.prank(direct_alice): contract.move_piece(1, 0, 1, 0, 4)
    with direct_vm.prank(direct_bob): contract.move_piece(1, 8, 7, 1, 5)
    with direct_vm.prank(direct_alice): contract.move_piece(1, 1, 2, 2, 6)
    final = record(contract)
    assert (final["outcome"], final["domain"]["winner"]) == ("NO_MOVE", address_text(direct_alice))
    assert json.loads(contract.list_cases(1, 4)) == {"ids": ["1"], "next": "0"}
    assert json.loads(contract.list_actor(direct_bob, 0, 4))["ids"] == ["1"]
    assert json.loads(contract.list_children(0, 0, 4)) == {"ids": [], "next": "0"}
    assert json.loads(contract.get_version(1, 4))["phase"] == "PLAYING"


def test_resign_assigns_other_player_and_blocks_cancel(direct_vm, direct_deploy, direct_alice, direct_bob):
    cells = matrix_cells([(0, 1), (8, 7)])
    direct_vm.mock_llm("Compile the frozen", {"v": 1, "supported": True, "cells": cells})
    contract = create_frozen(direct_vm, direct_deploy, direct_alice, direct_bob)
    contract.compile_moves(1, 2)
    with direct_vm.prank(direct_bob):
        contract.join_arena(1, 3)
        contract.resign_arena(1, 4)
    assert record(contract)["domain"]["winner"] == address_text(direct_alice)
    with direct_vm.expect_revert("BAD_PHASE"):
        contract.cancel_arena(1, 5)
