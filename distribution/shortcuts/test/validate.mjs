// @ts-check
// Pure validator for distribution/shortcuts/*.shortcut.json. Extracted
// out of the smoke test (`shortcuts-json.test.mjs`) so the test file
// stays free of `noExportsInTest` violations and so the function can
// be re-used by a future CLI / pre-commit hook.
//
// The shape this validates is the JSON-schema in
// `../schema/minsky-shortcut.schema.json`; the readable contract for
// humans is the schema, this is the deterministic gate (rule #10) over
// it. Cognitive complexity is kept ≤10 by splitting per `shortcut_kind`
// into one helper each — a future kind would add another helper.
//
// Anchor: rule #10 (deterministic enforcement); Beck XP 1999 (CI as
// the constraint enforcer).

const KIND_FETCH = "fetch-and-show";
const KIND_POST = "post-control";
const KIND_SETUP = "setup-variable";

const EXPECTED_PORT = 8080;
const EXPECTED_WATCH_PATH = "/watch.json";
const EXPECTED_CONTROL_PATH = "/control";

const TOP_LEVEL_REQUIRED = ["name", "description", "shortcut_kind", "anchor", "build_runbook"];

const HTTP_KIND_REQUIRED = ["endpoint", "display"];
const SETUP_KIND_REQUIRED = ["prompt", "set_variable"];

/**
 * @typedef {object} ValidatorContext
 * @property {ReadonlySet<string>} successMetricIds
 * @property {Readonly<Record<string, string>>} watchMetricIds
 */

/**
 * Pure validator. Returns the list of violations (empty = pass).
 *
 * @param {string} filename
 * @param {unknown} parsed
 * @param {ValidatorContext} ctx
 * @returns {string[]}
 */
export function validateShortcut(filename, parsed, ctx) {
  if (parsed === null || typeof parsed !== "object") {
    return [`${filename}: top-level must be an object`];
  }
  /** @type {Record<string, unknown>} */
  const cfg = /** @type {Record<string, unknown>} */ (parsed);
  const violations = checkTopLevelRequired(filename, cfg);
  if (cfg.shortcut_kind === KIND_SETUP) {
    pushAll(violations, checkSetupKind(filename, cfg));
    return violations;
  }
  pushAll(violations, checkRequiredKeys(filename, cfg, HTTP_KIND_REQUIRED));
  const ep = /** @type {Record<string, unknown> | undefined} */ (cfg.endpoint);
  if (ep === undefined || typeof ep !== "object") {
    violations.push(`${filename}: endpoint must be an object`);
    return violations;
  }
  pushAll(violations, checkEndpointShape(filename, ep));
  if (cfg.shortcut_kind === KIND_FETCH) {
    pushAll(violations, checkFetchKind(filename, ep, cfg, ctx));
  } else if (cfg.shortcut_kind === KIND_POST) {
    pushAll(violations, checkPostKind(filename, ep, cfg));
  } else {
    violations.push(
      `${filename}: shortcut_kind must be "${KIND_FETCH}", "${KIND_POST}", or "${KIND_SETUP}"`,
    );
  }
  return violations;
}

/**
 * @param {string} filename
 * @param {Record<string, unknown>} cfg
 * @param {readonly string[]} keys
 * @returns {string[]}
 */
function checkRequiredKeys(filename, cfg, keys) {
  /** @type {string[]} */
  const v = [];
  for (const key of keys) {
    if (!(key in cfg)) v.push(`${filename}: missing required key "${key}"`);
  }
  return v;
}

/**
 * @param {string} filename
 * @param {Record<string, unknown>} cfg
 * @returns {string[]}
 */
function checkSetupKind(filename, cfg) {
  /** @type {string[]} */
  const v = [];
  pushAll(v, checkRequiredKeys(filename, cfg, SETUP_KIND_REQUIRED));
  pushAll(
    v,
    checkActionBlock(
      filename,
      /** @type {Record<string, unknown> | undefined} */ (cfg.prompt),
      "prompt",
      "Ask for Input",
    ),
  );
  pushAll(
    v,
    checkActionBlock(
      filename,
      /** @type {Record<string, unknown> | undefined} */ (cfg.set_variable),
      "set_variable",
      "Set Variable",
    ),
  );
  return v;
}

/**
 * Validate a setup-variable action block (`prompt` or `set_variable`):
 * action matches the expected literal, and variable_name is a non-empty
 * string. Empty array if the block is absent (the missing-key violation
 * is reported by checkRequiredKeys).
 *
 * @param {string} filename
 * @param {Record<string, unknown> | undefined} block
 * @param {string} blockName
 * @param {string} expectedAction
 * @returns {string[]}
 */
function checkActionBlock(filename, block, blockName, expectedAction) {
  if (!block || typeof block !== "object") return [];
  /** @type {string[]} */
  const v = [];
  if (block.action !== expectedAction) {
    v.push(`${filename}: setup-variable ${blockName}.action must be "${expectedAction}"`);
  }
  if (typeof block.variable_name !== "string" || block.variable_name.length === 0) {
    v.push(`${filename}: setup-variable ${blockName}.variable_name must be a non-empty string`);
  }
  return v;
}

/**
 * @param {string} filename
 * @param {Record<string, unknown>} cfg
 * @returns {string[]}
 */
function checkTopLevelRequired(filename, cfg) {
  /** @type {string[]} */
  const v = [];
  for (const key of TOP_LEVEL_REQUIRED) {
    if (!(key in cfg)) v.push(`${filename}: missing required key "${key}"`);
  }
  if (typeof cfg.watch_surface !== "boolean") {
    v.push(`${filename}: watch_surface must be boolean`);
  }
  return v;
}

/**
 * @param {string} filename
 * @param {Record<string, unknown>} ep
 * @returns {string[]}
 */
function checkEndpointShape(filename, ep) {
  /** @type {string[]} */
  const v = [];
  if (ep.port !== EXPECTED_PORT) {
    v.push(`${filename}: endpoint.port must be ${EXPECTED_PORT}, got ${String(ep.port)}`);
  }
  if (typeof ep.url !== "string") {
    v.push(`${filename}: endpoint.url must be a string`);
    return v;
  }
  if (!ep.url.includes(`:${EXPECTED_PORT}`)) {
    v.push(`${filename}: endpoint.url must include :${EXPECTED_PORT}`);
  }
  if (typeof ep.path === "string" && !ep.url.endsWith(ep.path)) {
    v.push(`${filename}: endpoint.url must end with endpoint.path "${ep.path}"`);
  }
  return v;
}

/**
 * @param {string} filename
 * @param {Record<string, unknown>} ep
 * @param {Record<string, unknown>} cfg
 * @param {ValidatorContext} ctx
 * @returns {string[]}
 */
function checkFetchKind(filename, ep, cfg, ctx) {
  /** @type {string[]} */
  const v = [];
  if (ep.method !== "GET") v.push(`${filename}: fetch-and-show endpoint.method must be GET`);
  if (ep.path !== EXPECTED_WATCH_PATH) {
    v.push(`${filename}: fetch-and-show endpoint.path must be "${EXPECTED_WATCH_PATH}"`);
  }
  const ex = /** @type {Record<string, unknown> | undefined} */ (cfg.extract);
  if (ex === undefined || typeof ex !== "object") {
    v.push(`${filename}: fetch-and-show requires "extract" object`);
    return v;
  }
  pushAll(v, checkExtract(filename, ex, ctx));
  return v;
}

/**
 * @param {string} filename
 * @param {Record<string, unknown>} ex
 * @param {ValidatorContext} ctx
 * @returns {string[]}
 */
function checkExtract(filename, ex, ctx) {
  /** @type {string[]} */
  const v = [];
  if (ex.action !== "Get Dictionary Value") {
    v.push(`${filename}: extract.action must be "Get Dictionary Value"`);
  }
  const watchKeys = Object.keys(ctx.watchMetricIds);
  const keyOk = typeof ex.key === "string" && watchKeys.includes(ex.key);
  if (!keyOk) {
    v.push(
      `${filename}: extract.key "${String(ex.key)}" must be one of WatchEnvelope keys ${watchKeys.sort().join(", ")}`,
    );
  }
  const metricOk = typeof ex.metric_id === "string" && ctx.successMetricIds.has(ex.metric_id);
  if (!metricOk) {
    v.push(`${filename}: extract.metric_id "${String(ex.metric_id)}" must be a SuccessMetric.id`);
  }
  if (keyOk && metricOk) {
    const expected = ctx.watchMetricIds[/** @type {string} */ (ex.key)];
    if (expected !== ex.metric_id) {
      v.push(
        `${filename}: extract.metric_id "${String(ex.metric_id)}" must match WATCH_METRIC_IDS["${String(ex.key)}"]="${String(expected)}"`,
      );
    }
  }
  return v;
}

/**
 * @param {string} filename
 * @param {Record<string, unknown>} ep
 * @param {Record<string, unknown>} cfg
 * @returns {string[]}
 */
function checkPostKind(filename, ep, cfg) {
  /** @type {string[]} */
  const v = [];
  if (ep.method !== "POST") v.push(`${filename}: post-control endpoint.method must be POST`);
  if (ep.path !== EXPECTED_CONTROL_PATH) {
    v.push(`${filename}: post-control endpoint.path must be "${EXPECTED_CONTROL_PATH}"`);
  }
  const body = /** @type {Record<string, unknown> | undefined} */ (ep.request_body);
  if (body === undefined || typeof body !== "object") {
    v.push(`${filename}: post-control requires endpoint.request_body object`);
  } else if (typeof body.paused !== "boolean") {
    v.push(`${filename}: post-control endpoint.request_body.paused must be boolean`);
  }
  if (cfg.watch_surface === true) {
    v.push(
      `${filename}: post-control should not be on the Watch surface (noisy in user-story 002)`,
    );
  }
  return v;
}

/**
 * @param {string[]} target
 * @param {string[]} extra
 */
function pushAll(target, extra) {
  for (const e of extra) target.push(e);
}
