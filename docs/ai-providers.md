# AI Providers & Routing Strategy — Askarr

Askarr uses Large Language Models (LLMs) to understand natural conversational requests (e.g., *"Find that 90s thriller where detectives look for a serial killer in the rain"*), extract semantic search terms, and provide witty, theater-themed responses.

Crucially, **Askarr never relies on the LLM to guess media availability**. Media existence is always verified against your live Plex and Overseerr instances through deterministic API calls.

---

## 1. Supported AI Providers

Askarr natively supports five AI providers out of the box:

| Provider | Recommended Model | Typical Use Case | Environment Variable |
| :--- | :--- | :--- | :--- |
| **Google Gemini** | `gemini-2.5-flash` | Ultra-fast responses, generous free tier | `GEMINI_API_KEY` |
| **Groq Cloud** | `llama-3.3-70b-versatile` | Extremely high token throughput, low latency | `GROQ_API_KEY` |
| **Mistral AI** | `mistral-small-latest` | High linguistic accuracy, European hosting | `MISTRAL_API_KEY` |
| **OpenRouter** | `meta-llama/llama-3.3-70b-instruct` | Unified gateway with flexible free & paid models | `OPENROUTER_API_KEY` |
| **DeepSeek** | `deepseek-chat` | Cost-effective reasoning and semantic analysis | `DEEPSEEK_API_KEY` |

> **Third-Party Free Tier Notice**: Providers offering free tiers (such as Google AI Studio or Groq) have independent rate limits, terms of service, and quotas. Askarr cannot guarantee free tier availability or lifetime; configuring multiple providers or a paid backup key is strongly recommended.

---

## 2. Multi-Provider Routing Engine

Askarr includes an intelligent router in `src/server/services/aiRouter.ts` that manages provider health, tracks API latency, and handles errors transparently.

You can configure the active routing mode in the Admin UI or via `.env`:

```ini
AI_ROUTING_MODE=cascade_free_first
```

### Routing Modes

1. **`cascade_free_first` (Default & Recommended)**
   - Queries configured providers in order of cost efficiency.
   - If a provider responds with **HTTP 429 (Rate Limit / Quota Exceeded)** or **HTTP 5xx (Service Unavailable)**, the router instantly switches to the next configured provider within milliseconds.
   - Failed providers are placed into a temporary cool-down period before being retried.

2. **`round_robin`**
   - Distributes conversational turns evenly across all configured providers.
   - Useful for balancing usage across multiple accounts or developer API keys.

3. **`manual`**
   - Directs all queries strictly to a single designated provider.
   - If that provider encounters an error, the request immediately falls back to the deterministic search engine.

---

## 3. Direct Search Fallback (`runDirectSearchFallback`)

To ensure high availability in home environments, Askarr does not break if external AI APIs go down or if your internet connection temporarily throttles LLM endpoints.

If all configured LLM providers fail, Askarr activates its **Direct Search Fallback**:
1. It cleans and tokenizes the user's raw message using regular expressions.
2. It executes a direct metadata search on TMDB / Overseerr.
3. It performs a parallel availability lookup across your configured Plex Media Servers.
4. It presents the media card directly in the chat interface, enabling the user to watch or submit a request without interruption.

---

## 4. Privacy & Data Boundaries

Askarr operates on strict data minimization principles:

- **What reaches external LLMs**:
  - The text of the user's conversational message.
  - A condensed conversation history (limited to recent turns).
  - High-level genre and movie synopsis context needed for recommendations.
- **What NEVER reaches external LLMs**:
  - Private IP addresses, internal hostnames, or local URLs.
  - Plex administrator tokens (`X-Plex-Token`) or API keys.
  - Cloudflare Access identity headers or email addresses.
  - File paths, directory structures, or storage pool locations.
  - User watch history logs or sensitive credentials.
