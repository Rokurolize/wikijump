import crypto from 'node:crypto';
import states from '../fixtures/browser-acceptance-states.json' with {type: 'json'};
import {measureTitleComposition} from './title-composition.mjs';

export const SEMANTIC_BROWSER_MODEL = 'theme_lab_semantic_browser_acceptance.v1';
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validHash = value => /^[a-f0-9]{64}$/u.test(value ?? '');
export const TITLE_COMPOSITION_CONTRACT_SHA256 = crypto.createHash('sha256').update(measureTitleComposition.toString()).digest('hex');
const pendingImage = 'screenshot captured but awaiting image review';
const knownStates = new Set(states.states.map(row => `${row.surface}.${row.state}`));
const failureResponse = response => !response || response.type === 'failure' || response.status >= 400 || response.error_message;
export const observationKey = row => JSON.stringify([row.theme, row.browser_engine, row.viewport, row.surface, row.state]);


// These dependencies belong to this observation, not the Git tree, complete
// campaign inventory, audit bytes, or the source of the acceptance evaluator.
// Unknown dependencies remain conservatively covered by the candidate/fixture
// and surface hashes. They must not be guessed away by a selector heuristic.
export function observationDependencies(row) {
  return Object.fromEntries([
    'theme', 'candidate_sha256', 'candidate_source_sha256', 'base_css_sha256',
    'candidate_structure_sha256', 'baseline_theme_css_sha256', 'baseline_theme_mode',
    'asset_dependency_sha256', 'fixture_contract_sha256',
    'capture_state_action_contract_sha256', 'runtime_surface_contract_sha256',
    'title_composition_contract_sha256',
    'browser_engine', 'browser_version', 'viewport', 'viewport_size',
    'surface', 'state', 'session_state', 'target_site', 'locale', 'transport_origin'
  ].map(key => [key, row[key] ?? null]));
}

function safety(row) {
  if (row.failure || row.unconfirmed_items?.some(item => item !== pendingImage)) return 'fail';
  for (const key of ['asset_failures', 'page_errors', 'action_responses', 'unconfirmed_items']) {
    if (!Array.isArray(row[key])) return 'missing';
  }
  if (row.external_requests_sent !== 0 || row.asset_failures.length || row.page_errors.length || row.action_responses.some(failureResponse)) return 'fail';
  if (!validHash(row.screenshot_sha256) || !row.screenshot) return 'missing';
  return 'pass';
}

// No screenshot is needed to establish the observed action or document width.
// Successful action execution proves only the maintained harness execution,
// not complete usability, appearance, source intent or Wikidot parity.
export function measuredFacts(row) {
  const viewport = row.visual_diagnostics?.viewport;
  const documentWidth = viewport?.document_width ?? viewport?.documentWidth;
  const width = viewport?.client_width ?? viewport?.width;
  const action = row.action_contract_observation?.control === '#search-top-box-input' ? 'source-required' : knownStates.has(`${row.surface}.${row.state}`) && validHash(row.capture_state_action_contract_sha256)
    ? safety(row) : 'missing';
  return {
    observation_identity: ['candidate_sha256', 'candidate_source_sha256', 'baseline_theme_css_sha256',
      'asset_dependency_sha256', 'fixture_contract_sha256', 'capture_state_action_contract_sha256',
      'runtime_surface_contract_sha256'].every(key => validHash(row[key])) ? 'pass' : 'missing',
    capture_safety: safety(row),
    maintained_action_execution: action,
    document_containment: Number.isFinite(documentWidth) && Number.isFinite(width) && width > 0
      ? documentWidth <= width + 1 ? 'pass' : 'fail' : 'missing'
  };
}

// Intersecting boxes alone do not establish visual damage: hidden navigation
// descendants can have nonzero rectangles. The historical collector omitted
// their effective visibility. That is missing machine evidence, not a demand
// to look at every screenshot. A visible overlap is an actual composition
// question, complementary to the full check's surface and contrast probes.
export function titleCompositionFact(row) {
  const diagnostics = row.visual_diagnostics;
  const measurement = row.title_composition_measurement;
  const complete = measurement?.schema === 'theme_lab_title_composition.v1' && measurement.complete === true;
  if ((measurement || row.title_composition_contract_sha256) && (!complete || row.title_composition_contract_sha256 !== TITLE_COMPOSITION_CONTRACT_SHA256)) return 'missing';
  const overlaps = complete ? measurement.overlaps : diagnostics?.title_overlaps ?? diagnostics?.titleOverlaps;
  if (!Array.isArray(overlaps) || !complete && overlaps.length >= 16) return 'missing';
  if (overlaps.some(item => typeof item.effectively_visible !== 'boolean')) return 'missing';
  return overlaps.some(item => item.effectively_visible) ? 'visual' : 'pass';
}

const identityQuestion = 'Does the JP rendering preserve the frozen source theme’s intentional imagery, typography, palette and information hierarchy across the evidenced responsive layouts, allowing only documented localization differences?';

export function planBrowserAcceptance(audit) {
  const questions = new Map();
  const observations = [];
  for (const row of audit.records ?? []) {
    const key = observationKey(row), dependencies = observationDependencies(row);
    const facts = measuredFacts(row);
    facts.title_composition = titleCompositionFact(row);
    const required = [];
    if (row.surface === 'page.normal') {
      // One source-identity question can cite several responsive observations.
      // It requires a review of the whole declared evidence set, never an
      // unexplained representative image or screenshot-hash deduplication.
      const id = hash({kind: 'source_visual_identity', theme: row.theme,
        candidate: row.candidate_sha256, source: row.candidate_source_sha256,
        base: row.base_css_sha256 ?? null, baseline: row.baseline_theme_css_sha256});
      const question = questions.get(id) ?? {id, kind: 'source_visual_identity', theme: row.theme,
        question: identityQuestion, reason: 'Computed layout cannot decide preservation of artistic source identity.', observations: []};
      question.observations.push({key, dependencies_sha256: hash(dependencies), screenshot_sha256: row.screenshot_sha256});
      questions.set(id, question); required.push(id);
    }
    if (facts.title_composition === 'visual') {
      const overlaps = (row.title_composition_measurement?.overlaps ?? row.visual_diagnostics.title_overlaps ?? row.visual_diagnostics.titleOverlaps).filter(item => item.effectively_visible);
      // The obligation is the composition of these elements, not the action
      // that reached it. Geometry may vary responsively within one question;
      // every different state/image/dependency still enters its evidence set.
      // This does not declare the images equivalent or reuse a PASS by pixels.
      const elements = overlaps.map(item => Object.fromEntries(['tag','id','class','text','color','background','position','z'].map(key => [key,item[key]??null])))
        .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
      const id = hash({kind: 'ambiguous_title_composition', theme:row.theme,
        candidate:row.candidate_sha256, source:row.candidate_source_sha256,
        base:row.base_css_sha256??null, baseline:row.baseline_theme_css_sha256,
        fixture:row.fixture_contract_sha256, elements});
      const labels = [...new Set(elements.map(item=>item.id?`#${item.id}`:item.class?`${item.tag}.${item.class}`:`${item.tag}: ${String(item.text??'').slice(0,80)}`))].join('; ');
      const question = questions.get(id) ?? {id, kind: 'ambiguous_composition', theme: row.theme, intersecting_elements: elements,
        question: `For ${labels}, is the measured layering over the page title an intentional source composition across the declared responsive/action states, with the title readable in its intended reading state and intersecting controls usable in their action states?`,
        reason: 'Visibility and geometry establish an intersection; its intended composition requires source and visual interpretation.',
        observations: []};
      question.observations.push({key, dependencies_sha256: hash(dependencies), screenshot_sha256: row.screenshot_sha256});
      questions.set(id,question);
      required.push(id);
    }
    observations.push({key, dependencies_sha256: hash(dependencies), facts, visual_questions: required,
      machine_failures: Object.keys(facts).filter(name => facts[name] === 'fail'),
      additional_machine_evidence: Object.keys(facts).filter(name => facts[name] === 'missing')});
    observations.at(-1).additional_source_authority = Object.keys(facts).filter(name => facts[name] === 'source-required');
  }
  const visualQuestions = [...questions.values()].map(question => ({...question,
    evidence_sha256: hash(question.observations.slice().sort((a, b) => a.key.localeCompare(b.key)))}));
  return {schema: SEMANTIC_BROWSER_MODEL, decision_authority: 'SCP_JP_LOCAL_TARGET_ACCEPTANCE_ONLY',
    port_conclusion_eligible: false, observations, visual_questions: visualQuestions,
    accounting: {browser_records: observations.length,
      machine_settled_facts: observations.reduce((sum, row) => sum + Object.values(row.facts).filter(value => value === 'pass').length, 0),
      machine_failure_records: observations.filter(row => row.machine_failures.length).length,
      additional_machine_evidence_records: observations.filter(row => row.additional_machine_evidence.length).length,
      additional_source_authority_records: observations.filter(row => row.additional_source_authority.length).length,
      distinct_visual_questions: visualQuestions.length}};
}

export function validateSemanticBrowserAcceptance(audit) {
  const plan = planBrowserAcceptance(audit), failures = [];
  if (!plan.observations.length) failures.push('Semantic acceptance has no browser observations');
  for (const row of plan.observations) {
    for (const fact of row.machine_failures) failures.push(`${row.key}: machine failure ${fact}`);
    for (const fact of row.additional_machine_evidence) failures.push(`${row.key}: missing structured evidence ${fact}`);
    for (const fact of row.additional_source_authority) failures.push(`${row.key}: source authority required for ${fact}; the requested action was not exercised`);
  }
  for (const question of plan.visual_questions) {
    const review = audit.semantic_reviews?.[question.id];
    if (review?.question !== question.question || review?.evidence_sha256 !== question.evidence_sha256 ||
        review?.method !== 'direct-visual-question-review' || !['pass', 'warn'].includes(review?.status) ||
        typeof review?.note !== 'string' || review.note.trim().length < 12 ||
        typeof review?.reviewer !== 'string' || !review.reviewer.trim() || !Number.isFinite(Date.parse(review?.reviewed_at)) ||
        review?.decision_authority !== 'SCP_JP_LOCAL_TARGET_ACCEPTANCE_ONLY' || review.port_conclusion_eligible !== false ||
        !/^https:\/\/[a-z0-9-]+\.wikidot\.com\//u.test(review?.source_url ?? '') ||
        !['source_snapshot', 'source_html', 'source_rendering', 'source_rendering_receipt'].every(key => typeof review?.[key]?.path === 'string' && validHash(review[key].sha256))) {
      failures.push(`${question.theme}: unanswered or stale visual question ${question.id}`);
    }
  }
  return {status: failures.length ? 'inconclusive' : 'pass', failures, accounting: plan.accounting};
}

// Question reviews do not become source authority merely by naming a digest.
// Completion independently opens every source snapshot and source rendering.
export function semanticReviewArtifactBindings(audit) {
  return planBrowserAcceptance(audit).visual_questions.flatMap(question => {
    const review = audit.semantic_reviews?.[question.id];
    return ['source_snapshot', 'source_html', 'source_rendering', 'source_rendering_receipt'].map(key => ({binding: review?.[key], label: `${question.theme}/${question.kind}/${key}`}));
  });
}
