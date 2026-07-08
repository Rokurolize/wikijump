/*
 * services/page_query/count_pages.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

use super::PageQueryResultMetadata;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CountPagesExactCountEligibilityInput {
    pub metadata: PageQueryResultMetadata,
    pub view_permission_filtering_applied: bool,
    pub post_query_filtering_applied: bool,
    pub post_query_exclusion_applied: bool,
    pub post_query_offset_applied: bool,
    pub explicit_count_pages_bound_matches_sql_window: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CountPagesExactCountEligibilityDecision {
    pub allowed: bool,
    pub denied_reason: Option<CountPagesExactCountDenialReason>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CountPagesExactCountDenialReason {
    Unsupported { reason: String },
    CapExceeded,
    FilteringDeferredToRust,
    OrderingDeferredToRust,
    NotExactCountSafe,
    UnsafeSqlWindow,
    ViewPermissionFiltering,
    PostQueryFiltering,
    PostQueryExclusion,
    PostQueryOffset,
}

pub fn count_pages_exact_count_eligibility(
    input: CountPagesExactCountEligibilityInput,
) -> CountPagesExactCountEligibilityDecision {
    let denied_reason = if let Some(reason) = input.metadata.unsupported_reason {
        Some(CountPagesExactCountDenialReason::Unsupported { reason })
    } else if input.metadata.cap_exceeded {
        Some(CountPagesExactCountDenialReason::CapExceeded)
    } else if input.metadata.filtering_deferred_to_rust {
        Some(CountPagesExactCountDenialReason::FilteringDeferredToRust)
    } else if input.metadata.ordering_deferred_to_rust {
        Some(CountPagesExactCountDenialReason::OrderingDeferredToRust)
    } else if !input.metadata.exact_count_safe {
        Some(CountPagesExactCountDenialReason::NotExactCountSafe)
    } else if input.view_permission_filtering_applied {
        Some(CountPagesExactCountDenialReason::ViewPermissionFiltering)
    } else if input.post_query_filtering_applied {
        Some(CountPagesExactCountDenialReason::PostQueryFiltering)
    } else if input.post_query_exclusion_applied {
        Some(CountPagesExactCountDenialReason::PostQueryExclusion)
    } else if input.post_query_offset_applied {
        Some(CountPagesExactCountDenialReason::PostQueryOffset)
    } else if input.metadata.sql_limit_offset_applied
        && !input.explicit_count_pages_bound_matches_sql_window
    {
        Some(CountPagesExactCountDenialReason::UnsafeSqlWindow)
    } else {
        None
    };

    CountPagesExactCountEligibilityDecision {
        allowed: denied_reason.is_none(),
        denied_reason,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn exact_metadata() -> PageQueryResultMetadata {
        PageQueryResultMetadata {
            candidate_count: Some(12),
            exact_count_safe: true,
            ..PageQueryResultMetadata::default()
        }
    }

    fn input(metadata: PageQueryResultMetadata) -> CountPagesExactCountEligibilityInput {
        CountPagesExactCountEligibilityInput {
            metadata,
            view_permission_filtering_applied: false,
            post_query_filtering_applied: false,
            post_query_exclusion_applied: false,
            post_query_offset_applied: false,
            explicit_count_pages_bound_matches_sql_window: false,
        }
    }

    fn reason(
        input: CountPagesExactCountEligibilityInput,
    ) -> Option<CountPagesExactCountDenialReason> {
        count_pages_exact_count_eligibility(input).denied_reason
    }

    #[test]
    fn count_pages_exact_count_allows_plain_exact_metadata() {
        let decision = count_pages_exact_count_eligibility(input(exact_metadata()));

        assert!(decision.allowed);
        assert_eq!(decision.denied_reason, None);
    }

    #[test]
    fn count_pages_exact_count_denies_score_deferred_ordering() {
        let mut metadata = exact_metadata();
        metadata.ordering_deferred_to_rust = true;
        metadata.exact_count_safe = false;

        assert_eq!(
            reason(input(metadata)),
            Some(CountPagesExactCountDenialReason::OrderingDeferredToRust),
        );
    }

    #[test]
    fn count_pages_exact_count_denies_data_form_deferred_filtering() {
        let mut metadata = exact_metadata();
        metadata.filtering_deferred_to_rust = true;
        metadata.exact_count_safe = false;

        assert_eq!(
            reason(input(metadata)),
            Some(CountPagesExactCountDenialReason::FilteringDeferredToRust),
        );
    }

    #[test]
    fn count_pages_exact_count_denies_cap_exceeded() {
        let mut metadata = exact_metadata();
        metadata.cap_exceeded = true;
        metadata.exact_count_safe = false;

        assert_eq!(
            reason(input(metadata)),
            Some(CountPagesExactCountDenialReason::CapExceeded),
        );
    }

    #[test]
    fn count_pages_exact_count_denies_unsupported_query() {
        let mut metadata = exact_metadata();
        metadata.unsupported_reason = Some("data form ordering".to_owned());
        metadata.exact_count_safe = false;

        assert_eq!(
            reason(input(metadata)),
            Some(CountPagesExactCountDenialReason::Unsupported {
                reason: "data form ordering".to_owned(),
            }),
        );
    }

    #[test]
    fn count_pages_exact_count_denies_unsafe_sql_window() {
        let mut metadata = exact_metadata();
        metadata.sql_limit_offset_applied = true;

        assert_eq!(
            reason(input(metadata)),
            Some(CountPagesExactCountDenialReason::UnsafeSqlWindow),
        );
    }

    #[test]
    fn count_pages_exact_count_allows_sql_window_with_explicit_matching_bound() {
        let mut metadata = exact_metadata();
        metadata.sql_limit_offset_applied = true;
        let mut input = input(metadata);
        input.explicit_count_pages_bound_matches_sql_window = true;

        let decision = count_pages_exact_count_eligibility(input);

        assert!(decision.allowed);
        assert_eq!(decision.denied_reason, None);
    }

    #[test]
    fn count_pages_exact_count_denies_view_permission_filtering() {
        let mut input = input(exact_metadata());
        input.view_permission_filtering_applied = true;

        assert_eq!(
            reason(input),
            Some(CountPagesExactCountDenialReason::ViewPermissionFiltering),
        );
    }

    #[test]
    fn count_pages_exact_count_denies_post_query_exclusion() {
        let mut input = input(exact_metadata());
        input.post_query_exclusion_applied = true;

        assert_eq!(
            reason(input),
            Some(CountPagesExactCountDenialReason::PostQueryExclusion),
        );
    }

    #[test]
    fn count_pages_exact_count_denies_post_query_offset() {
        let mut input = input(exact_metadata());
        input.post_query_offset_applied = true;

        assert_eq!(
            reason(input),
            Some(CountPagesExactCountDenialReason::PostQueryOffset),
        );
    }

    #[test]
    fn count_pages_exact_count_denies_post_query_filtering() {
        let mut input = input(exact_metadata());
        input.post_query_filtering_applied = true;

        assert_eq!(
            reason(input),
            Some(CountPagesExactCountDenialReason::PostQueryFiltering),
        );
    }

    #[test]
    fn count_pages_exact_count_denies_metadata_not_marked_exact_count_safe() {
        let mut metadata = exact_metadata();
        metadata.exact_count_safe = false;

        assert_eq!(
            reason(input(metadata)),
            Some(CountPagesExactCountDenialReason::NotExactCountSafe),
        );
    }
}
