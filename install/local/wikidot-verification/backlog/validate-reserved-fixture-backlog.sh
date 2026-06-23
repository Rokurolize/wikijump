#!/usr/bin/env bash
set -euo pipefail

BACKLOG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TSV="${BACKLOG_DIR}/reserved-fixture-backlog.tsv"
SCHEMA_HEADER=$'slug\tpriority\tfixture_type\tsource_branch\tsource_path\tlocal_corpus_status\tknown_dependencies\tprimary_risk\trecommended_issue\tstatus\tnotes'
REQUIRED_SLUGS=(scp-3352 scp-8980 scp-anthology-2024 scp-9506)

if [[ ! -f "${TSV}" ]]; then
  echo "MISSING: ${TSV}" >&2
  exit 1
fi

HEADER=$(head -n 1 "${TSV}")
if [[ "${HEADER}" != "${SCHEMA_HEADER}" ]]; then
  echo "INVALID HEADER" >&2
  echo "Expected: ${SCHEMA_HEADER}" >&2
  echo "Actual:   ${HEADER}" >&2
  exit 1
fi

TSV_PATH="${TSV}" \
python3 - <<'PY'
import csv
import os
import sys

path = os.environ['TSV_PATH']
required = {"scp-3352", "scp-8980", "scp-anthology-2024", "scp-9506"}
allowed_issues = {"#4", "#7", "#8", "#6", "#9", "follow-up"}
allowed_types = {"simple", "listpages", "resource_heavy", "broad_parity"}
allowed_local = {"present", "missing", "pending-import"}
allowed_status = {"planned", "in_progress", "blocked", "done"}

with open(path, newline='', encoding='utf-8') as f:
    reader = csv.DictReader(f, delimiter='\t')
    rows = list(reader)

errors = []
seen = set()
for row in rows:
    slug = row['slug'].strip()
    if not slug:
        errors.append('empty slug')
        continue
    if slug in seen:
        errors.append(f'duplicate slug: {slug}')
    seen.add(slug)

    p = row['priority'].strip()
    try:
        int(p)
    except ValueError:
        errors.append(f'non-integer priority for {slug}: {p}')

    if row['fixture_type'] not in allowed_types:
        errors.append(f'invalid fixture_type for {slug}: {row["fixture_type"]}')
    if row['local_corpus_status'] not in allowed_local:
        errors.append(f'invalid local_corpus_status for {slug}: {row["local_corpus_status"]}')
    if row['status'] not in allowed_status:
        errors.append(f'invalid status for {slug}: {row["status"]}')

    if row['recommended_issue'] not in allowed_issues:
        errors.append(f'invalid recommended_issue for {slug}: {row["recommended_issue"]}')

    if row['local_corpus_status'] == 'present':
        src = row['source_path'].strip()
        if not src:
            errors.append(f'missing source_path for present row {slug}')
        elif not os.path.isfile(src):
            errors.append(f'missing source file for {slug}: {src}')

for slug in required:
    if not any(r['slug'] == slug for r in rows):
        errors.append(f'required slug missing: {slug}')

if errors:
    print('VALIDATION FAILED')
    for err in errors:
        print(f'- {err}')
    sys.exit(1)

print('VALIDATION PASSED')
print(f'rows={len(rows)}')
print(f'unique_slugs={len(seen)}')
PY
