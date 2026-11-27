use std::fmt;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};

pub(in crate::services::render) type SharedRenderCostBudget = Arc<RenderCostBudget>;

pub(in crate::services::render) const DEFAULT_RENDER_COST_UNITS: u64 = 1_000_000;
pub(in crate::services::render) const DEFAULT_EXPANDED_OUTPUT_BYTE_BUDGET: usize =
    4 * 1024 * 1024;
pub(in crate::services::render) const MAX_SELECTED_CONTENT_RENDER_DEPTH: usize = 8;

#[derive(Debug)]
pub(in crate::services::render) struct RenderCostBudget {
    remaining: AtomicU64,
    remaining_expanded_bytes: AtomicUsize,
    nested_render_depth: AtomicUsize,
    exhausted: AtomicUsize,
}

#[derive(Debug, Eq, PartialEq)]
pub(in crate::services::render) struct RenderBudgetExceeded {
    pub(in crate::services::render) operation: &'static str,
    pub(in crate::services::render) requested: u64,
    pub(in crate::services::render) remaining: u64,
}

impl fmt::Display for RenderBudgetExceeded {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "render cost budget exhausted during {} (requested {}, remaining {})",
            self.operation, self.requested, self.remaining,
        )
    }
}

impl std::error::Error for RenderBudgetExceeded {}

impl RenderCostBudget {
    pub(in crate::services::render) fn new(maximum: u64) -> SharedRenderCostBudget {
        Self::with_expanded_byte_budget(maximum, DEFAULT_EXPANDED_OUTPUT_BYTE_BUDGET)
    }

    pub(in crate::services::render) fn with_expanded_byte_budget(
        maximum: u64,
        maximum_expanded_bytes: usize,
    ) -> SharedRenderCostBudget {
        Arc::new(Self {
            remaining: AtomicU64::new(maximum),
            remaining_expanded_bytes: AtomicUsize::new(maximum_expanded_bytes),
            nested_render_depth: AtomicUsize::new(0),
            exhausted: AtomicUsize::new(0),
        })
    }

    pub(in crate::services::render) fn new_default() -> SharedRenderCostBudget {
        Self::new(DEFAULT_RENDER_COST_UNITS)
    }

    pub(in crate::services::render) fn charge_expanded_bytes(
        &self,
        requested: usize,
        operation: &'static str,
    ) -> Result<(), RenderBudgetExceeded> {
        let mut remaining = self.remaining_expanded_bytes.load(Ordering::Relaxed);
        loop {
            if requested > remaining {
                self.exhausted.store(1, Ordering::Relaxed);
                return Err(RenderBudgetExceeded {
                    operation,
                    requested: requested as u64,
                    remaining: remaining as u64,
                });
            }
            match self.remaining_expanded_bytes.compare_exchange_weak(
                remaining,
                remaining - requested,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => return Ok(()),
                Err(observed) => remaining = observed,
            }
        }
    }

    pub(super) fn charge(
        &self,
        requested: u64,
        operation: &'static str,
    ) -> Result<(), RenderBudgetExceeded> {
        let mut remaining = self.remaining.load(Ordering::Relaxed);
        loop {
            if requested > remaining {
                self.exhausted.store(1, Ordering::Relaxed);
                return Err(RenderBudgetExceeded {
                    operation,
                    requested,
                    remaining,
                });
            }
            match self.remaining.compare_exchange_weak(
                remaining,
                remaining - requested,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => return Ok(()),
                Err(observed) => remaining = observed,
            }
        }
    }

    pub(super) fn is_exhausted(&self) -> bool {
        self.exhausted.load(Ordering::Relaxed) != 0
    }

    pub(super) fn enter_nested_render(
        self: &SharedRenderCostBudget,
        maximum_depth: usize,
    ) -> Result<NestedRenderGuard, RenderBudgetExceeded> {
        let mut depth = self.nested_render_depth.load(Ordering::Relaxed);
        loop {
            if depth >= maximum_depth {
                return Err(RenderBudgetExceeded {
                    operation: "nested selected-content render",
                    requested: 1,
                    remaining: 0,
                });
            }
            match self.nested_render_depth.compare_exchange_weak(
                depth,
                depth + 1,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => {
                    return Ok(NestedRenderGuard {
                        budget: Arc::clone(self),
                    });
                }
                Err(observed) => depth = observed,
            }
        }
    }
}

#[derive(Debug)]
pub(super) struct NestedRenderGuard {
    budget: SharedRenderCostBudget,
}

impl Drop for NestedRenderGuard {
    fn drop(&mut self) {
        self.budget
            .nested_render_depth
            .fetch_sub(1, Ordering::Relaxed);
    }
}

#[test]
fn shared_budget_rejects_a_charge_after_exhaustion() {
    let budget = RenderCostBudget::new(3);

    budget.charge(2, "test").expect("first charge fits");
    let error = budget
        .charge(2, "test")
        .expect_err("second charge exceeds the budget");

    assert_eq!(error.operation, "test");
    assert_eq!(error.requested, 2);
    assert_eq!(error.remaining, 1);
}

#[test]
fn nested_render_guard_shares_depth_across_budget_clones() {
    let budget = RenderCostBudget::new(10);
    let clone = Arc::clone(&budget);

    let guard = budget
        .enter_nested_render(1)
        .expect("first nested render fits");
    assert!(clone.enter_nested_render(1).is_err());
    drop(guard);
    clone
        .enter_nested_render(1)
        .expect("dropping the guard releases the depth");
}

#[test]
fn expanded_byte_budget_is_shared_across_operations() {
    let budget = RenderCostBudget::with_expanded_byte_budget(100, 1_000);
    let clone = Arc::clone(&budget);

    budget
        .charge_expanded_bytes(400, "include variable expansion")
        .expect("first include fits");
    clone
        .charge_expanded_bytes(350, "selected-content render")
        .expect("selected-content render fits");
    let error = clone
        .charge_expanded_bytes(300, "site changes feed")
        .expect_err("cumulative bytes exceed 1000");

    assert_eq!(error.operation, "site changes feed");
    assert_eq!(error.requested, 300);
    assert_eq!(error.remaining, 250);
    assert!(budget.is_exhausted());
}

#[test]
fn default_expanded_byte_budget_covers_legitimate_large_pages() {
    let budget = RenderCostBudget::new_default();
    let single_subcap = 768_000;

    // Five full 768,000-byte includes (3.84 MB) fit under the 4 MiB default budget.
    for _ in 0..5 {
        budget
            .charge_expanded_bytes(single_subcap, "include variable expansion")
            .expect("legitimate large page includes fit");
    }

    // A sixth 768,000-byte include (4.608 MB) exceeds the 4 MiB default budget.
    assert!(
        budget
            .charge_expanded_bytes(single_subcap, "include variable expansion")
            .is_err()
    );
}
