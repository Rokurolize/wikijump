const IMPLEMENTATION_BOUNDS = Object.freeze({
  max_modules_per_render: 512,
  max_module_source_bytes_per_render: 2 * 1024 * 1024,
  max_template_body_bytes: 256 * 1024,
  max_generated_output_bytes_per_render: 16 * 1024 * 1024,
});

function utf8Bytes(value) {
  return Buffer.byteLength(value ?? "", "utf8");
}

function numericAttribute(record, name, fallback) {
  const attribute = (record.attributes ?? []).find(
    (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
  );
  if (!attribute || !/^[0-9]+$/.test(attribute.value)) return fallback;
  const parsed = Number(attribute.value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function firstPageRows(record) {
  return Math.min(
    numericAttribute(record, "perPage", 20),
    numericAttribute(record, "limit", Number.POSITIVE_INFINITY),
    250,
  );
}

function maximum(values, field) {
  return values.reduce((selected, candidate) => {
    if (!selected || candidate[field] > selected[field]) return candidate;
    return selected;
  }, null);
}

export function buildListPagesRuntimeBudgetEnvelope(records, source) {
  const pages = new Map();
  let maximumBody = null;
  let maximumFirstPage = null;

  for (const record of records) {
    const pageKey = `${record.branch}\u0000${record.page_fullname}`;
    const page = pages.get(pageKey) ?? {
      branch: record.branch,
      page_fullname: record.page_fullname,
      modules: 0,
      module_span_bytes: 0,
      template_body_bytes: 0,
    };
    const bodyBytes = utf8Bytes(record.body);
    page.modules += 1;
    page.module_span_bytes += record.byte_end - record.byte_start;
    page.template_body_bytes += bodyBytes;
    pages.set(pageKey, page);

    if (!maximumBody || bodyBytes > maximumBody.value) {
      maximumBody = {
        value: bodyBytes,
        invocation_id: record.id,
        branch: record.branch,
        page_fullname: record.page_fullname,
      };
    }

    const estimatedRows = firstPageRows(record);
    const estimatedBytes = bodyBytes * estimatedRows;
    if (!maximumFirstPage || estimatedBytes > maximumFirstPage.value) {
      maximumFirstPage = {
        value: estimatedBytes,
        invocation_id: record.id,
        branch: record.branch,
        page_fullname: record.page_fullname,
        template_body_bytes: bodyBytes,
        estimated_rows: estimatedRows,
      };
    }
  }

  const pageValues = [...pages.values()];
  const modules = maximum(pageValues, "modules");
  const spans = maximum(pageValues, "module_span_bytes");
  const bodies = maximum(pageValues, "template_body_bytes");
  const measurements = {
    max_modules_per_page: {
      value: modules?.modules ?? 0,
      branch: modules?.branch ?? null,
      page_fullname: modules?.page_fullname ?? null,
    },
    max_aggregate_module_span_bytes_per_page: {
      value: spans?.module_span_bytes ?? 0,
      branch: spans?.branch ?? null,
      page_fullname: spans?.page_fullname ?? null,
    },
    max_aggregate_template_body_bytes_per_page: {
      value: bodies?.template_body_bytes ?? 0,
      branch: bodies?.branch ?? null,
      page_fullname: bodies?.page_fullname ?? null,
    },
    max_template_body_bytes: maximumBody ?? {
      value: 0,
      invocation_id: null,
      branch: null,
      page_fullname: null,
    },
    max_estimated_first_page_template_bytes: maximumFirstPage ?? {
      value: 0,
      invocation_id: null,
      branch: null,
      page_fullname: null,
      template_body_bytes: 0,
      estimated_rows: 0,
    },
  };
  const sourceEnvelope = Math.max(
    measurements.max_aggregate_module_span_bytes_per_page.value,
    measurements.max_aggregate_template_body_bytes_per_page.value,
  );
  const checks = {
    modules:
      measurements.max_modules_per_page.value
      <= IMPLEMENTATION_BOUNDS.max_modules_per_render,
    module_source_bytes:
      sourceEnvelope
      <= IMPLEMENTATION_BOUNDS.max_module_source_bytes_per_render,
    template_body_bytes:
      measurements.max_template_body_bytes.value
      <= IMPLEMENTATION_BOUNDS.max_template_body_bytes,
    generated_output_bytes:
      measurements.max_estimated_first_page_template_bytes.value
      <= IMPLEMENTATION_BOUNDS.max_generated_output_bytes_per_render,
  };

  return {
    schema: "wikijump_listpages_compat.runtime_budget_envelope.v1",
    generated_at: source.inventoryGeneratedAt,
    source: {
      inventory_path: source.inventoryPath,
      inventory_sha256: source.inventorySha256,
      invocation_count: records.length,
      page_count: pages.size,
    },
    method: {
      byte_encoding: "UTF-8",
      page_identity: "branch + page_fullname",
      first_page_estimate:
        "template_body_bytes * min(valid numeric perPage or 20, valid numeric limit or infinity, 250)",
      caveat:
        "The first-page figure is a conservative authored-template expansion estimate before variable substitution; runtime tests separately cover substitution amplification and exact append accounting.",
    },
    measurements,
    implementation_bounds: {
      ...IMPLEMENTATION_BOUNDS,
      checks,
      all_measurements_fit: Object.values(checks).every(Boolean),
    },
  };
}
