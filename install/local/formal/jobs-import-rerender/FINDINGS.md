# Jobs, import, and outdate

Three checks. `JobSettlement.tla` is C1. `ImportLattice.tla` is C9. `OutdateFanout.tla` is C11. C10 stays in `install/local/formal/rerender-lifecycle/`. No product code was changed.

`extract.py` reads the anchors on every run. A moved comparison or a reordered `queue_follow_up` changes the constant TLC uses.

## C1 settlement

`settle_job_execution` queues `NextJob::Next` and then deletes the message. `is_final_attempt` is `receive_count >= max_attempts`. Production config sets `max-attempts = 3`. The compiled default in `config/object.rs` is 1. The model checks the production bound, so one failure is requeued and the third failure deletes the message.

`AckedOrExhausted` and `ChainLives` hold. A success deletes the message only after the successor exists. An error deletes it when the receive count equals the bound. `job-armed` fails `NeverArmed`, so the gap between those two calls is reachable. `check.sh mutations` deletes first (`SuccessorFirst = FALSE`) and `ChainLives` fails. It also treats the final attempt as `>` (`FinalOnEqual = FALSE`) and `AckedOrExhausted` fails.

Not in this model: a second delivery while the first execution is still inside the 30 second visibility window. That overlap is the duplicate rerender in the C10 model.

## C9 import lattice

One item, two passes, `DEFAULT_MAX_ATTEMPTS` 3. Claim and the observation insert are one SQL statement. A crash is the state after the lease has expired. `shell_ready` is not a finalizer state.

`AttemptsBound` and `OneHolder` hold. An expired lease with attempts still left is claimed again (`EarlyRecovers`). A `rendered` item with attempts left leaves that state (`Pass2Claims`).

`TerminalOrRetry` passes. Claims no longer consume an attempt: the claim leaves `attempts` alone and exports the current attempt number (`item.attempts + 1`), an expired-lease reclaim reuses the same attempt number, and only `mark_item_failed` increments. Pass 1 can therefore fail twice and succeed on attempt 3 with `attempts = 2` still below the bound, so Pass 2 still claims the `rendered` item and takes it to `done`.

`Restartable` passes. A crash on the third attempt leaves `render_running` with an expired lease and `attempts = 2`, so the next finalizer invocation reclaims it into the same attempt number; a failed third attempt is the one that records `attempts = 3` and goes terminal.

`check.sh mutations` drops the pass split and `OneHolder` fails. It also claims past the bound and `AttemptsBound` fails.

## C11 outdate fan-out

The configured first rule, in local, dev, and prod, is job depth 3 and 100 ms. The comparison in `updated_recently!` is `now() > updated_at + duration`. That skips a page whose `updated_at` is older than the offset. The warning text says "updated too recently". The check follows the comparison.

`p1` and `p2` are old and sit below depth 3, so both render once and take the new content. `p3` is at depth 3. An old `p3` is skipped. A recent `p3` renders once. A second outdate of the same page and depth does not queue another job.

`check.sh mutations` flips the comparison to skip recent pages, and `BelowBoundOnce` fails. It also turns dedupe off, `p1` renders twice, and `BelowBoundOnce` fails.

The depth-10 and depth-50 rules are outside this bound. The compiled default in `config/object.rs` starts at depth 1 and is not what the three config files load.
