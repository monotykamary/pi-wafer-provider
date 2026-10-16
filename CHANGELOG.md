# Changelog

## 1.1.44

- Pin Pi SDK development dependencies to 1.3.0 while retaining wildcard host peers; verify real manifest loading, lifecycle and native/bundled Pi hosts offline.

## 1.1.42

- Pin Pi SDK development dependencies to 1.2.0 while retaining wildcard host peers; verify real manifest loading, lifecycle and native/bundled Pi hosts offline.

## 1.1.41

- Quiet startup sync: background `/v1/models` revalidation runs only with an API key, only when the disk cache is older than 1 hour (`PI_PROVIDER_SYNC_TTL_MS`, `0` = always), missing, or fetched with a different key, and only in one pi process at a time (lock file next to the cache). Failed refreshes back off for 5 minutes; sessions that skip adopt a cache refreshed by another process.
- Never store the API key: key changes are detected via a salted sha256 fingerprint in `cache/wafer-serverless-models.sync.json`. The cache file format is unchanged.
- Write the model cache atomically and swallow API key resolution failures in `session_start`.
- Add vitest coverage for the sync policy and the session_start integration.

## 1.1.36

- Validate provider registration and session lifecycle against Pi 1.0.0; update the pinned development SDK.

## 1.1.33

- Test against Pi 0.99.0 and declare host-provided modules as wildcard peers.
- Replace no-op checks with scoped TypeScript checks and an offline real-Pi loader, provider-registration, and session-lifecycle smoke test.
