use std::fmt;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};

pub(super) type SharedRenderCostBudget = Arc<RenderCostBudget>;

pub(super) const DEFAULT_RENDER_COST_UNITS: u64 = 1_000_000;
pub(super) const MAX_SELECTED_CONTENT_RENDER_DEPTH: usize = 8;

#[derive(Debug)]
pub(super) struct RenderCostBudget {
    remaining: AtomicU64,
    nested_render_depth: AtomicUsize,
}

#[derive(Debug, Eq, PartialEq)]
pub(super) struct RenderBudgetExceeded {
    pub(super) operation: &'static str,
    pub(super) requested: u64,
    pub(super) remaining: u64,
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
    pub(super) fn new(maximum: u64) -> SharedRenderCostBudget {
        Arc::new(Self {
            remaining: AtomicU64::new(maximum),
            nested_render_depth: AtomicUsize::new(0),
        })
    }

    pub(super) fn new_default() -> SharedRenderCostBudget {
        Self::new(DEFAULT_RENDER_COST_UNITS)
    }

    pub(super) fn charge(
        &self,
        requested: u64,
        operation: &'static str,
    ) -> Result<(), RenderBudgetExceeded> {
        let mut remaining = self.remaining.load(Ordering::Relaxed);
        loop {
            if requested > remaining {
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
