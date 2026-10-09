# Generated gate close mutation disposition review

Assessment packet for the unresolved outcomes in generated-gate-close-unit-mutation-20261009. All proposals remain pending and are not accepted owner dispositions. Independent review is required before changing the audit ledger.

Source: deepwell/src/services/render/list_pages/scanner.rs (fba6a6f254ecbdbeabdf49a65642917d40d95ff11b714242943431459b7835fb)

| Mutation | Observed | Proposed disposition | Evidence |
|---|---|---|---|
| src/services/render/list_pages/scanner.rs:234:45: replace + with - in generated_gate_module_close | missed | equivalent / non-actionable mutant | docs/development/test-quality-audit/generated-gate-close-unit-mutation-20261009/target-0/mutants.out/log/src__services__render__list_pages__scanner.rs_line_234_col_45.log (sha256 7ac4bb8df49cc3f6da26e78d4d5b6da28c8f8b9a9c40aede45e3ef8d40ee88ec) |
| src/services/render/list_pages/scanner.rs:236:67: replace + with - in generated_gate_module_close | missed | equivalent / non-actionable mutant | docs/development/test-quality-audit/generated-gate-close-unit-mutation-20261009/target-0/mutants.out/log/src__services__render__list_pages__scanner.rs_line_236_col_67.log (sha256 ac0ff224ef0f550ce0aba1f66549d051b4a80644b7a38d2b4de9bcecfea87239) |
| src/services/render/list_pages/scanner.rs:259:13: replace && with || in generated_gate_module_close | unviable | compilation failure | docs/development/test-quality-audit/generated-gate-close-unit-mutation-20261009/target-0/mutants.out/log/src__services__render__list_pages__scanner.rs_line_259_col_13.log (sha256 ae0ce1aaf1bbc8afddbc677b3c79049a781d169d90387e6133905179cbb57aa2) |
| src/services/render/list_pages/scanner.rs:263:24: replace += with *= in generated_gate_module_close | timeout | demonstrated mutation-induced nonprogress | docs/development/test-quality-audit/generated-gate-close-unit-mutation-20261009/target-0/mutants.out/log/src__services__render__list_pages__scanner.rs_line_263_col_24_001.log (sha256 b738047d4611d19f512b94dc35d2a96f8b4c7ba9ddb5a7b6fcd9d5e6e2f3be62) |
| src/services/render/list_pages/scanner.rs:269:24: replace + with - in generated_gate_module_close | timeout | demonstrated mutation-induced nonprogress | docs/development/test-quality-audit/generated-gate-close-unit-mutation-20261009/target-0/mutants.out/log/src__services__render__list_pages__scanner.rs_line_269_col_24.log (sha256 df698d3f5f74e88b25b7cd4675380f7f9cddb4755c0d4a04e21728812ec8cf5e) |
| src/services/render/list_pages/scanner.rs:269:24: replace + with * in generated_gate_module_close | timeout | demonstrated mutation-induced nonprogress | docs/development/test-quality-audit/generated-gate-close-unit-mutation-20261009/target-0/mutants.out/log/src__services__render__list_pages__scanner.rs_line_269_col_24_001.log (sha256 aef7d8b032b7c2f5530a113138e3c5ed4fab5370179cc0691b6589bb4fe81c96) |

## Reasoning for review

- The first survivor changes branch_start from marker_start plus 7 to marker_start minus 7. The following search begins 14 bytes earlier and adds that same adjusted offset, so close_start and the range end remain identical. The additional interval consists of the 7-byte prefix before the marker plus the 7-byte marker; an 11-byte module closer cannot fit wholly in the prefix, and the marker bytes cannot form or overlap that closer.

- The second survivor changes the exclusive inactive-range end from after the 8-byte comment terminator to before it. Every complete 11-byte module closer in the inactive branch remains inside the range; the comment terminator cannot contain or overlap the closer token.

- The boolean-operator variant does not type-check the Rust let-chain; its retained compiler log is the evidence for compilation failure.

- The three timeout variants replace monotone progress with a repeated index or search position. The retained mutant logs identify each timeout.

No disposition is accepted yet. Review each source-bound argument and evidence log independently.
