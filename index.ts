/**
 * Wafer Provider Extension
 *
 * Registers Wafer Serverless as a custom provider using the
 * OpenAI completions API.
 * 
 * Model resolution strategy: Stale-While-Revalidate
 *   1. Serve stale immediately: disk cache → embedded models.json (zero-latency)
 *   2. Revalidate in background: live API /models → merge with embedded → cache → hot-swap
 *   3. patch.json + custom-models.json applied on top of whichever source won
 *   
 * Merge order: [live|cache|embedded] → apply patch.json → merge custom-models.json
 *
 * Provider:
 *   - wafer-serverless  (WAFER_SERVERLESS_API_KEY, falls back to WAFER_API_KEY)
 *
 * Usage:
 *   # Option 1: Store in auth.json (recommended)
 *   # Add to ~/.pi/agent/auth.json:
 *   #   "wafer-serverless":  { "type": "api_key", "key": "your-wafer-serverless-key" }
 *
 *   # Option 2: Set as environment variables
 *   export WAFER_SERVERLESS_API_KEY=your-wafer-serverless-key
 *   # Falls back to WAFER_API_KEY for backwards compatibility
 *
 *   # Run pi with the extension
 *   pi -e /path/to/pi-wafer-provider
 *
 * Then use /model to select available models:
 *   - Qwen3.5-397B-A17B (262K context)
 *   - GLM-5.1 (202K context)
 */

import { getAgentDir, type ExtensionAPI, type ModelRegistry } from "@earendil-works/pi-coding-agent";
import modelsData from "./models.json" with { type: "json" };
import customModelsData from "./custom-models.json" with { type: "json" };
import patchData from "./patch.json" with { type: "json" };
import deprecatedData from "./deprecated-models.json" with { type: "json" };
import fs from "fs";
import path from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

interface JsonModel {
  id: string;
  name: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  contextWindow: number;
  maxTokens: number;
  thinkingLevelMap?: Record<string, string | null>;
  providers?: string[];
  headers?: Record<string, string>;
  compat?: {
    supportsDeveloperRole?: boolean;
    supportsStore?: boolean;
    maxTokensField?: "max_completion_tokens" | "max_tokens";
    thinkingFormat?: "openai" | "zai" | "qwen" | "qwen-chat-template";
    supportsReasoningEffort?: boolean;
    supportsZdr?: boolean;
  };
}

interface PatchEntry {
  name?: string;
  reasoning?: boolean;
  input?: ("text" | "image")[];
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  contextWindow?: number;
  maxTokens?: number;
  thinkingLevelMap?: Record<string, string | null>;
  providers?: string[];
  compat?: Record<string, unknown>;
}

type PatchData = Record<string, PatchEntry>;

// ─── Patch Application ─────────────────────────────────────────────────────────

function applyPatch(model: JsonModel, patch: PatchEntry): JsonModel {
  const result = { ...model };

  if (patch.name !== undefined) result.name = patch.name;
  if (patch.reasoning !== undefined) result.reasoning = patch.reasoning;
  if (patch.input !== undefined) result.input = patch.input;
  if (patch.contextWindow !== undefined) result.contextWindow = patch.contextWindow;
  if (patch.maxTokens !== undefined) result.maxTokens = patch.maxTokens;
  if (patch.providers !== undefined) result.providers = patch.providers;

  if (patch.cost) {
    result.cost = {
      input: patch.cost.input ?? result.cost.input,
      output: patch.cost.output ?? result.cost.output,
      cacheRead: patch.cost.cacheRead ?? result.cost.cacheRead,
      cacheWrite: patch.cost.cacheWrite ?? result.cost.cacheWrite,
    };
  }
  if (patch.compat) {
    result.compat = { ...(result.compat || {}), ...patch.compat };
  }

  if (!result.reasoning && result.compat?.thinkingFormat) {
    delete result.compat.thinkingFormat;
  }
  if (result.compat && Object.keys(result.compat).length === 0) {
    delete result.compat;
  }

  return result;
}

/** Full pipeline: base models → patch → custom → result */
function buildModels(base: JsonModel[], custom: JsonModel[], patch: PatchData): JsonModel[] {
  const modelMap = new Map<string, JsonModel>();

  for (const model of base) {
    modelMap.set(model.id, model);
  }

  for (const [id, patchEntry] of Object.entries(patch)) {
    const existing = modelMap.get(id);
    if (existing) {
      modelMap.set(id, applyPatch(existing, patchEntry));
    }
  }

  for (const model of custom) {
    const existing = modelMap.get(model.id);
    const patchEntry = patch[model.id];
    if (existing && patchEntry) {
      modelMap.set(model.id, applyPatch(model, patchEntry));
    } else if (existing) {
      modelMap.set(model.id, model);
    } else if (patchEntry) {
      modelMap.set(model.id, applyPatch(model, patchEntry));
    } else {
      modelMap.set(model.id, model);
    }
  }

  return Array.from(modelMap.values());
}

/** Filter models to only those belonging to the given provider, then strip the `providers` field. */
function filterModelsForProvider(models: JsonModel[], providerId: string): JsonModel[] {
  return models
    .filter((m) => !m.providers || m.providers.includes(providerId))
    .map(({ providers, ...rest }) => rest);
}

/** Apply per-model ZDR header unless the model explicitly opts out. */
function applyZdrHeaders(models: JsonModel[]): JsonModel[] {
  return models.map((model) => {
    // default: ZDR supported; omit header only if compat.supportsZdr === false
    if (model.compat?.supportsZdr === false) return model;
    return {
      ...model,
      headers: { ...(model.headers || {}), "Wafer-ZDR": "required" },
    };
  });
}

// ─── Stale-While-Revalidate Model Sync ────────────────────────────────────────

const BASE_URL = "https://pass.wafer.ai/v1";
const MODELS_URL = `${BASE_URL}/models`;
const CACHE_DIR = path.join(getAgentDir(), "cache");
const LIVE_FETCH_TIMEOUT_MS = 8000;

interface ProviderConfig {
  providerId: string;
  apiKeyEnv: string;
  fallbackApiKeyEnv?: string;
}

/** Transform a model from the Wafer /v1/models API. */
function transformApiModel(apiModel: any): JsonModel | null {
  return {
    id: apiModel.id,
    name: apiModel.id,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: apiModel.max_model_len || 0,
    maxTokens: 0,
    compat: {
      supportsZdr: apiModel.zdr_supported ?? undefined,
      supportsReasoningEffort: true,
    },
  };
}

function getCachePath(providerId: string): string {
  return path.join(CACHE_DIR, `${providerId}-models.json`);
}

async function fetchLiveModels(apiKey: string, signal?: AbortSignal): Promise<JsonModel[] | null> {
  try {
    const response = await fetch(MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: signal ? AbortSignal.any([AbortSignal.timeout(LIVE_FETCH_TIMEOUT_MS), signal]) : AbortSignal.timeout(LIVE_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const apiModels = Array.isArray(data) ? data : (data.data || []);
    if (!Array.isArray(apiModels) || apiModels.length === 0) return null;
    return apiModels.map(transformApiModel).filter((m): m is JsonModel => m !== null);
  } catch {
    return null;
  }
}

function loadCachedModels(providerId: string): JsonModel[] | null {
  try {
    const data = JSON.parse(fs.readFileSync(getCachePath(providerId), "utf8"));
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

function cacheModels(providerId: string, models: JsonModel[]): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(getCachePath(providerId), JSON.stringify(models, null, 2) + "\n");
  } catch {
    // Cache write failure is non-fatal
  }
}

function mergeWithEmbedded(liveModels: JsonModel[], embeddedModels: JsonModel[]): JsonModel[] {
  const embeddedMap = new Map(embeddedModels.map(m => [m.id, m]));
  const seen = new Set<string>();
  const result: JsonModel[] = [];
  for (const liveModel of liveModels) {
    const embedded = embeddedMap.get(liveModel.id);
    seen.add(liveModel.id);
    if (embedded) {
      // Self-heal: live API pricing is authoritative field-by-field. Prefer the
      // live cost when the API reports it (non-zero); fall back to embedded when
      // the API is silent (0) so curated cacheRead/cacheWrite isn't clobbered and
      // providers whose /models endpoint exposes no pricing keep their curated
      // cost. Curation (reasoning/input/compat/name) still wins via ...embedded.
      result.push({
        ...liveModel,
        ...embedded,
        cost: {
          input: liveModel.cost.input || embedded.cost.input,
          output: liveModel.cost.output || embedded.cost.output,
          cacheRead: liveModel.cost.cacheRead || embedded.cost.cacheRead,
          cacheWrite: liveModel.cost.cacheWrite || embedded.cost.cacheWrite,
        },
        contextWindow: liveModel.contextWindow || embedded.contextWindow,
      });
    } else {
      result.push(liveModel);
    }
  }
  // Append any embedded models that the live API didn't return
  for (const em of embeddedModels) {
    if (!seen.has(em.id)) {
      result.push(em);
    }
  }
  return result;
}

// Grace period for delisted models. When the provider API stops listing a
// model, update-models.js moves its last-known definition into
// deprecated-models.json (stamped with deprecatedAt) instead of dropping it.
// For 14 days the model keeps working here so in-flight sessions and saved
// model settings do not break; afterwards it is evicted permanently.
const DEPRECATED_MODEL_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// Grace-period deprecated models with deprecation metadata stripped.
function activeDeprecatedModels(): JsonModel[] {
  const now = Date.now();
  const result: JsonModel[] = [];
  for (const entry of Object.values(deprecatedData as Record<string, JsonModel & { deprecatedAt?: string }>)) {
    if (!entry?.id) continue;
    const removedAt = Date.parse(entry.deprecatedAt ?? "");
    if (Number.isNaN(removedAt) || now - removedAt > DEPRECATED_MODEL_TTL_MS) continue;
    const model = { ...entry } as JsonModel & { deprecatedAt?: string };
    delete model.deprecatedAt;
    result.push(model);
  }
  return result;
}

// Append grace-period deprecated models the list does not already have (live data wins).
function withDeprecated(models: JsonModel[]): JsonModel[] {
  const seen = new Set(models.map((m) => m.id));
  const extras = activeDeprecatedModels().filter((m) => !seen.has(m.id));
  return extras.length > 0 ? [...models, ...extras] : models;
}

function loadStaleModels(providerId: string, embeddedModels: JsonModel[]): JsonModel[] {
  const cached = loadCachedModels(providerId);
  if (!cached || cached.length === 0) return embeddedModels;

  // Merge embedded models that are missing from cache (newly added models)
  const cachedMap = new Map(cached.map(m => [m.id, m]));
  for (const em of embeddedModels) {
    if (!cachedMap.has(em.id)) {
      cached.push(em);
    }
  }
  return cached;
}

async function revalidateModels(providerId: string, apiKey: string | undefined, embeddedModels: JsonModel[], signal?: AbortSignal): Promise<JsonModel[] | null> {
  if (!apiKey) return null;
  const liveModels = await fetchLiveModels(apiKey, signal);
  if (!liveModels || liveModels.length === 0) return null;
  const merged = mergeWithEmbedded(liveModels, embeddedModels);
  cacheModels(providerId, merged);
  return merged;
}

// ─── Per-Provider State ───────────────────────────────────────────────────────

interface ProviderState {
  cachedApiKey: string | undefined;
  revalidateAbort: AbortController | null;
}

function createProviderState(): ProviderState {
  return { cachedApiKey: undefined, revalidateAbort: null };
}

/** Resolve API key from pi auth registry, falling back to env vars. */
async function resolveApiKey(state: ProviderState, providerId: string, modelRegistry: ModelRegistry, config: ProviderConfig): Promise<void> {
  state.cachedApiKey =
    (await modelRegistry.getApiKeyForProvider(providerId))
    ?? resolveEnvKeyValue(config)
    ?? undefined;
}

/** Resolve the actual API key value from environment (for fetch calls). */
function resolveEnvKeyValue(config: ProviderConfig): string | undefined {
  const { apiKeyEnv, fallbackApiKeyEnv } = config;
  return process.env[apiKeyEnv] || (fallbackApiKeyEnv ? process.env[fallbackApiKeyEnv] : undefined);
}

/** Resolve the $-prefixed env var reference for registerProvider.
 *  Uses the primary key if set, otherwise the fallback key if set,
 *  otherwise defaults to the primary key name (pi marks it unresolved). */
function resolveEnvKeyRef(config: ProviderConfig): string {
  const { apiKeyEnv, fallbackApiKeyEnv } = config;
  if (process.env[apiKeyEnv]) return `$${apiKeyEnv}`;
  if (fallbackApiKeyEnv && process.env[fallbackApiKeyEnv]) return `$${fallbackApiKeyEnv}`;
  return `$${apiKeyEnv}`;
}

function registerWaferProvider(
  pi: ExtensionAPI,
  config: ProviderConfig,
  embeddedModels: JsonModel[],
  customModels: JsonModel[],
  patches: PatchData,
): void {
  const { providerId } = config;
  const state = createProviderState();

  const staleBase = loadStaleModels(providerId, embeddedModels);
  const staleModels = filterModelsForProvider(
    buildModels(staleBase, customModels, patches),
    providerId,
  );

  pi.registerProvider(providerId, {
    baseUrl: BASE_URL,
    apiKey: resolveEnvKeyRef(config),
    api: "openai-completions",
    models: applyZdrHeaders(withDeprecated(staleModels)),
  });

  pi.on("session_start", async (_event, ctx) => {
    state.revalidateAbort?.abort();
    state.revalidateAbort = new AbortController();
    const signal = state.revalidateAbort.signal;
    resolveApiKey(state, providerId, ctx.modelRegistry, config).then(() => {
      revalidateModels(providerId, state.cachedApiKey, embeddedModels, signal).then((freshBase) => {
        if (freshBase && !signal.aborted) {
          pi.registerProvider(providerId, {
            baseUrl: BASE_URL,
            apiKey: resolveEnvKeyRef(config),
            api: "openai-completions",
            models: applyZdrHeaders(
              withDeprecated(filterModelsForProvider(buildModels(freshBase, customModels, patches), providerId)),
            ),
          });
        }
      });
    });
  });

  pi.on("session_shutdown", () => {
    state.revalidateAbort?.abort();
  });
}

// ─── Provider Definitions ────────────────────────────────────────────────────

const PROVIDER: ProviderConfig = {
  providerId: "wafer-serverless",
  apiKeyEnv: "WAFER_SERVERLESS_API_KEY",
  fallbackApiKeyEnv: "WAFER_API_KEY",
};

// ─── Extension Entry Point ────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  const embeddedModels = modelsData as JsonModel[];
  const customModels = customModelsData as JsonModel[];
  const patches = patchData as PatchData;

  registerWaferProvider(pi, PROVIDER, embeddedModels, customModels, patches);
}
