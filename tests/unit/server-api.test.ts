import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { AskarrDatabase } from '../../src/server/db/database.js';
import {
  DeepSeekOrchestratorService,
  READ_ONLY_TOOLS_DEFINITIONS,
  sanitizeToolsForProvider
} from '../../src/server/orchestrator/deepseek-orchestrator.service.js';
import { loadConfig } from '../../src/server/config/env.js';
import { PlexMultiServerConnector } from '../../src/server/connectors/plex.connector.js';
import type { MediaAggregatorService } from '../../src/server/aggregator/media-aggregator.service.js';
import type { OverseerrConnector } from '../../src/server/connectors/overseerr.connector.js';

describe('AskarrDatabase SQLite WAL & Ledger Tests', () => {
  it('T-DB-01: initializes SQLite in WAL mode, creates conversations, messages, and tracks LLM usage budget', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askarr-test-'));
    const dbPath = path.join(tmpDir, 'test.sqlite');

    const db = new AskarrDatabase(dbPath);
    const convId = db.ensureConversation('friend@example.com', undefined, 'Recherche films SF');

    db.addMessage({
      conversationId: convId,
      role: 'user',
      content: 'Conseille-moi un film de SF'
    });
    db.addMessage({
      conversationId: convId,
      role: 'assistant',
      content: 'Je te recommande Interstellar (8.7/10 sur IMDb).'
    });

    const messages = db.getConversationMessages(convId, 'friend@example.com');
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('user');
    expect(messages[1].content).toContain('Interstellar');

    db.recordLlmUsage({
      conversationId: convId,
      userEmail: 'friend@example.com',
      model: 'deepseek-chat',
      toolRounds: 1,
      promptTokens: 1500,
      promptCacheHitTokens: 1000,
      promptCacheMissTokens: 500,
      completionTokens: 300,
      estimatedCostUsd: 0.0005,
      latencyMs: 950,
      fallbackUsed: false
    });

    const stats = db.getLlmBudgetStats(500000, 10.0);
    expect(stats.dailyTokensUsed).toBe(1800);
    expect(stats.monthlyCostUsd).toBeCloseTo(0.0005, 5);
    expect(stats.isOverQuota).toBe(false);
    expect(stats.modelBenchmarks).toHaveLength(1);
    expect(stats.modelBenchmarks[0].model).toBe('deepseek-chat');

    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('T-LLM-ROUTER-01: routes across free LLMs (priority_cascade & load_balance), sanitizes tool schemas, and fails over on HTTP 429', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askarr-router-'));
    const dbPath = path.join(tmpDir, 'test.sqlite');
    const db = new AskarrDatabase(dbPath);

    // 1. Verify schema sanitization for strict OpenAI-compatible endpoints (Gemini/Groq/Mistral)
    const sanitizedGemini = sanitizeToolsForProvider(READ_ONLY_TOOLS_DEFINITIONS, 'gemini');
    const searchToolParams = (sanitizedGemini[0] as { function: { parameters: Record<string, unknown> } }).function
      .parameters;
    expect(searchToolParams.additionalProperties).toBeUndefined();

    // 2. Configure Gemini (Free), Groq (Free), and DeepSeek (Paid)
    const cfg = loadConfig({
      SQLITE_DB_PATH: dbPath,
      LLM_ROUTING_MODE: 'priority_cascade',
      GEMINI_API_KEY: 'AIzaSyTestGeminiKey',
      GEMINI_MODEL: 'gemini-2.5-flash',
      GROQ_API_KEY: 'gsk_testGroqKey',
      GROQ_MODEL: 'llama-3.3-70b-versatile',
      DEEPSEEK_API_KEY: 'sk-testDeepseekKey'
    });

    const calledUrls: string[] = [];
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      calledUrls.push(url);
      if (url.includes('generativelanguage.googleapis.com')) {
        // Simulate HTTP 429 rate-limit on Gemini Free Tier
        return new Response('Rate limit exceeded', { status: 429 });
      }
      if (url.includes('api.groq.com')) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: 'Salut ! Voici une réponse instantanée via Groq LPU gratuit.'
                }
              }
            ],
            usage: {
              prompt_tokens: 900,
              completion_tokens: 45
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const orchestrator = new DeepSeekOrchestratorService(
      cfg,
      db,
      {} as MediaAggregatorService,
      {} as OverseerrConnector,
      mockFetch
    );

    // Verify priority_cascade order: Gemini -> Groq -> DeepSeek
    const cascadeOrder = orchestrator.selectProviderCandidates(false).map((p) => p.id);
    expect(cascadeOrder).toEqual(['gemini', 'groq', 'deepseek']);

    // Verify load_balance round-robin rotation
    cfg.llmRoutingMode = 'load_balance';
    const rr1 = orchestrator.selectProviderCandidates(false)[0].id;
    const rr2 = orchestrator.selectProviderCandidates(false)[0].id;
    const rr3 = orchestrator.selectProviderCandidates(false)[0].id;
    expect([rr1, rr2, rr3]).toEqual(['gemini', 'groq', 'deepseek']);

    // Switch back to priority_cascade and execute a chat turn where Gemini 429s and Groq succeeds
    cfg.llmRoutingMode = 'priority_cascade';
    const turn = await orchestrator.handleUserMessage({
      userEmail: 'friend@example.com',
      overseerrUserId: null,
      message: 'Merci beaucoup !'
    });

    expect(calledUrls).toHaveLength(2);
    expect(calledUrls[0]).toContain('generativelanguage.googleapis.com');
    expect(calledUrls[1]).toContain('api.groq.com');
    expect(turn.llmUsage?.providerId).toBe('groq');
    expect(turn.llmUsage?.isFreeProvider).toBe(true);
    expect(turn.llmUsage?.estimatedCostUsd).toBe(0);
    expect(turn.llmUsage?.failoverFrom).toBe('Google Gemini (gemini-3.5-flash-lite)');

    const stats = db.getLlmBudgetStats(500000, 10.0);
    expect(stats.monthlyCostUsd).toBe(0);
    expect(stats.modelBenchmarks[0].model).toBe('groq/openai/gpt-oss-120b');

    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('T-PLEX-PLAYER-01: discovers Plex players (Apple TV) and casts media via PlayQueue + /player/playback/playMedia', async () => {
    const calledUrls: string[] = [];
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      calledUrls.push(url);

      if (url.includes('plex.tv/devices.xml')) {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<MediaContainer>
  <Device name="Apple TV Salon" product="Plex for Apple TV" platform="tvOS" device="Apple TV" model="14,1" clientIdentifier="ATV-TEST-123" provides="client,player,pubsub-player" lastSeenAt="${Math.floor(Date.now() / 1000)}" presence="1">
    <Connection uri="http://192.168.10.136:32500" />
  </Device>
</MediaContainer>`;
        return new Response(xml, { status: 200, headers: { 'Content-Type': 'application/xml' } });
      }

      if (url.includes('plex.tv/api/v2/resources')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (url.includes('/clients') || url.includes('/status/sessions')) {
        return new Response(JSON.stringify({ MediaContainer: { size: 0 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (url.includes('192.168.10.136:32500/resources')) {
        return new Response('<MediaContainer><Player title="Apple TV Salon" machineIdentifier="ATV-TEST-123"/></MediaContainer>', {
          status: 200
        });
      }

      if (url.includes('/playQueues')) {
        return new Response(
          JSON.stringify({
            MediaContainer: {
              playQueueID: 4126,
              Metadata: [{ key: '/library/metadata/14585', ratingKey: '14585' }]
            }
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      if (url.includes('192.168.10.136:32500/player/playback/playMedia')) {
        return new Response('<Response code="200" status="OK"/>', { status: 200 });
      }

      return new Response('{}', { status: 200 });
    };

    const plex = new PlexMultiServerConnector(
      [
        {
          name: 'NucVillers',
          baseUrl: 'http://192.168.1.163:32400'
        }
      ],
      'test-plex-token',
      mockFetch
    );

    const players = await plex.discoverPlayers({ forceRefresh: true });
    expect(players.length).toBeGreaterThanOrEqual(1);
    const appleTv = players.find((p) => p.clientIdentifier === 'ATV-TEST-123');
    expect(appleTv).toBeDefined();
    expect(appleTv?.name).toBe('Apple TV Salon');
    expect(appleTv?.isOnline).toBe(true);
    expect(appleTv?.address).toBe('192.168.10.136');

    const castRes = await plex.castMediaToPlayer({
      clientIdentifier: 'ATV-TEST-123',
      ratingKey: '14585',
      serverName: 'NucVillers'
    });

    expect(castRes.ok).toBe(true);
    expect(castRes.deliveryMethod).toBe('lan_direct');
    expect(castRes.playQueueId).toBe(4126);
    expect(calledUrls.some((u) => u.includes('/playQueues'))).toBe(true);
    expect(calledUrls.some((u) => u.includes('192.168.10.136:32500/player/playback/playMedia'))).toBe(true);
  });
});
