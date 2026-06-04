<div align="center">

# 🧇 pi-wafer-provider

**Qwen3.5, GLM-5.1, Kimi K2.6 & more via [Wafer](https://wafer.ai)**

_Serverless inference with free DeepSeek V4 models for [pi](https://github.com/earendil-works/pi-coding-agent)._

[![pi extension](https://img.shields.io/badge/pi-extension-blueviolet)](https://github.com/earendil-works/pi-coding-agent)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

</div>

---

## Features

- **Fast Open-Source Models** via Wafer Serverless
- **Unified API** via Wafer's OpenAI-compatible completions endpoint
- **Cost Tracking** with per-model pricing for budget management
- **Reasoning Models** support for advanced reasoning capabilities
- **Vision Support** for Qwen3.5 (image + text input)

## Provider

| Provider | API Key Env Var | Auth JSON Key |
|----------|----------------|---------------|
| `wafer-serverless` | `WAFER_SERVERLESS_API_KEY` | `wafer-serverless` |

Use `/model` in pi to select from available models.

## Installation

### Option 1: Using `pi install` (Recommended)

Install directly from GitHub:

```bash
pi install https://github.com/monotykamary/pi-wafer-provider
```

Then set your API key and run pi:
```bash
# Recommended: add to auth.json
# See Authentication section below

# Or set as environment variables
export WAFER_SERVERLESS_API_KEY=your-serverless-key

pi
```

### Option 2: Manual Clone

1. Clone this repository:
   ```bash
   git clone https://github.com/monotykamary/pi-wafer-provider.git
   cd pi-wafer-provider
   ```

2. Set your Wafer API key:
   ```bash
   # Recommended: add to auth.json
   # See Authentication section below

   # Or set as environment variables
   export WAFER_SERVERLESS_API_KEY=your-serverless-key
   ```

3. Run pi with the extension:
   ```bash
   pi -e /path/to/pi-wafer-provider
   ```

## Available Models

| Model | Type | Context | Max Output | Input Cost | Output Cost | Cached Input |
|-------|------|---------|------------|------------|-------------|--------------|
| Deepseek V4 Flash | Text | 1M | 16K | Free | Free | Free |
| Deepseek V4 Pro | Text | 1M | 384K | Free | Free | Free |
| GLM 5.1 | Text | 203K | 33K | $1.50 | $4.50 | $0.15 |
| Kimi K2.6 | Text | 262K | 33K | $1.10 | $4.80 | $0.11 |
| MiniMax M3 | Text | 1M | 16K | Free | Free | Free |
| Qwen 3.5 397B (A17B) | Text + Image | 262K | 33K | $0.60 | $3.60 | $0.06 |
| Qwen3.6 35B A3B | Text | 256K | 16K | Free | Free | Free |
| Qwen3.7 Max | Text | 256K | 16K | $5.00 | $15.00 | $0.50 |

*Costs are per million tokens. Prices based on official provider pricing.*

## Usage

After loading the extension, use the `/model` command in pi to select your preferred model:

```
/model
```

Then select `wafer-serverless` as the provider and choose from the available models.

## Authentication

API keys can be configured in multiple ways (resolved in this order):

1. **`auth.json`** (recommended) — Add to `~/.pi/agent/auth.json`:
   ```json
   {
     "wafer-serverless":  { "type": "api_key", "key": "your-serverless-key" }
   }
   ```
   The `key` field supports literal values, env var names, and shell commands (prefix with `!`). See [pi's auth file docs](https://github.com/badlogic/pi-mono) for details.
2. **Runtime override** — Use the `--api-key` CLI flag
3. **Environment variable** — Set `WAFER_SERVERLESS_API_KEY` (falls back to `WAFER_API_KEY` for backwards compatibility)

## Environment Variables

| Variable | Provider | Description |
|----------|----------|-------------|
| `WAFER_SERVERLESS_API_KEY` | `wafer-serverless` | Primary API key |
| `WAFER_API_KEY` | `wafer-serverless` | Legacy fallback (used if `WAFER_SERVERLESS_API_KEY` is unset) |

## Configuration

Add to your pi configuration for automatic loading:

```json
{
  "extensions": [
    "/path/to/pi-wafer-provider"
  ]
}
```

## License

MIT
