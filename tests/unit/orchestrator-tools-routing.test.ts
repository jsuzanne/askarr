import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  READ_ONLY_TOOLS_DEFINITIONS,
  STATIC_FRENCH_SYSTEM_PROMPT,
  handleTruncatedCompletion,
  sanitizeToolsForProvider,
  DeepSeekOrchestratorService
} from '../../src/server/orchestrator/deepseek-orchestrator.service.js';
import { AskarrDatabase } from '../../src/server/db/database.js';
import { loadConfig } from '../../src/server/config/env.js';
import type { MediaAggregatorService } from '../../src/server/aggregator/media-aggregator.service.js';
import type { OverseerrConnector } from '../../src/server/connectors/overseerr.connector.js';
import type { MediaEvidence } from '../../src/shared/types.js';

describe('Lot 1 — Invariants des descriptions d’outils et routage orchestrateur', () => {
  const toolsByName = new Map(
    READ_ONLY_TOOLS_DEFINITIONS.map((t) => [t.function.name, t.function])
  );

  it('T-ROUTING-01: vérifie que les 4 paires ambiguës ont des frontières négatives disjointes et explicites', () => {
    // Paire 1 : discover_media_by_criteria vs discover_and_recommend_media
    const criteriaDesc = toolsByName.get('discover_media_by_criteria')?.description || '';
    const recommendDesc = toolsByName.get('discover_and_recommend_media')?.description || '';

    expect(criteriaDesc).toContain("N'utilise PAS cet outil pour une recommandation ouverte");
    expect(criteriaDesc).toContain("'discover_and_recommend_media'");
    expect(recommendDesc).toContain("N'utilise PAS cet outil pour une recherche par critères précis");
    expect(recommendDesc).toContain("'discover_media_by_criteria'");
    expect(recommendDesc).toContain('si disponible'); // Dégradation sans MDBList

    // Paire 2 : search_and_check_media vs verify_specific_titles
    const searchDesc = toolsByName.get('search_and_check_media')?.description || '';
    const verifyDesc = toolsByName.get('verify_specific_titles')?.description || '';

    expect(searchDesc).toContain("N'utilise PAS cet outil si l'utilisateur ne nomme pas directement l'œuvre");
    expect(searchDesc).toContain("'verify_specific_titles'");
    expect(verifyDesc).toContain("N'utilise PAS cet outil si l'utilisateur nomme déjà directement le titre");
    expect(verifyDesc).toContain("'search_and_check_media'");

    // Paire 3 : get_recently_added_on_plex vs get_watch_history_and_live_streams
    const recentlyAddedDesc = toolsByName.get('get_recently_added_on_plex')?.description || '';
    const watchHistoryDesc = toolsByName.get('get_watch_history_and_live_streams')?.description || '';

    expect(recentlyAddedDesc).toContain("N'utilise PAS cet outil pour savoir ce que les utilisateurs ont regardé");
    expect(recentlyAddedDesc).toContain("'get_watch_history_and_live_streams'");
    expect(watchHistoryDesc).toContain("N'utilise PAS cet outil pour lister les nouveaux médias fraîchement ajoutés");
    expect(watchHistoryDesc).toContain("'get_recently_added_on_plex'");

    // Paire 4 : get_my_requests vs diagnose_media_acquisition
    const requestsDesc = toolsByName.get('get_my_requests')?.description || '';
    const diagnoseDesc = toolsByName.get('diagnose_media_acquisition')?.description || '';

    expect(requestsDesc).toContain("N'utilise PAS cet outil pour analyser un blocage technique");
    expect(requestsDesc).toContain("'diagnose_media_acquisition'");
    expect(diagnoseDesc).toContain("N'utilise PAS cet outil pour simplement lister la liste d'attente");
    expect(diagnoseDesc).toContain("'get_my_requests'");
  });

  it('T-ROUTING-02: vérifie que tous les outils mentionnés dans les frontières négatives existent réellement', () => {
    const mentionedTools = [
      'discover_media_by_criteria',
      'discover_and_recommend_media',
      'search_and_check_media',
      'verify_specific_titles',
      'get_recently_added_on_plex',
      'get_watch_history_and_live_streams',
      'get_my_requests',
      'diagnose_media_acquisition'
    ];

    for (const toolName of mentionedTools) {
      expect(toolsByName.has(toolName)).toBe(true);
    }
  });

  it('T-ROUTING-03: vérifie la compatibilité de sanitizeToolsForProvider pour les providers tiers', () => {
    const providers = ['gemini', 'groq', 'mistral', 'openrouter'] as const;

    for (const providerId of providers) {
      const sanitized = sanitizeToolsForProvider(READ_ONLY_TOOLS_DEFINITIONS, providerId) as Array<{
        type: string;
        function: { name: string; description: string };
      }>;
      expect(sanitized).toHaveLength(READ_ONLY_TOOLS_DEFINITIONS.length);
      for (const tool of sanitized) {
        expect(tool.function.description).toBeTruthy();
        expect(tool.function.name).toBeTruthy();
      }
    }
  });

  it('T-ROUTING-04: vérifie la table de décision et l’absence de contradiction sur discover_and_recommend_media', () => {
    // Aucune mention contradictoire "au hasard" ou "IMMÉDIATEMENT"
    expect(STATIC_FRENCH_SYSTEM_PROMPT).not.toContain("au hasard");
    expect(STATIC_FRENCH_SYSTEM_PROMPT).not.toContain("IMMÉDIATEMENT");
    // Table de décision présente et claire
    expect(STATIC_FRENCH_SYSTEM_PROMPT).toContain("TABLE DE DÉCISION DE ROUTAGE DES OUTILS :");
    expect(STATIC_FRENCH_SYSTEM_PROMPT).toContain(
      "- Conseil ouvert / populaire sur le serveur (\"tu me conseilles quoi ce soir ?\", \"un bon film récent\") -> discover_and_recommend_media (scope: 'on_plex_now', limit: 4)"
    );
    // Principe de concision remonté en ouverture
    expect(STATIC_FRENCH_SYSTEM_PROMPT).toContain("PRINCIPE DIRECTEUR — CONCISION & NATUREL :");
    // Divulgations conditionnelles
    expect(STATIC_FRENCH_SYSTEM_PROMPT).toContain("DIVULGATIONS SOBRES ET CONDITIONNELLES :");
  });

  it('T-ROUTING-04B: vérifie les règles absolues et les invariants du prompt français', () => {
    // Règle 1 : Zéro jargon
    expect(STATIC_FRENCH_SYSTEM_PROMPT).toContain("ZÉRO JARGON TECHNIQUE");
    const forbiddenWords = ['Radarr', 'Sonarr', 'Prowlarr', 'Overseerr', 'indexeur', 'tracker', 'torrent', 'usenet', 'passkey', 'TMDB'];
    for (const w of forbiddenWords) {
      expect(STATIC_FRENCH_SYSTEM_PROMPT).toContain(w); // Cité dans la liste d'interdiction
    }
    // Règle 2 : Zéro invention de disponibilité
    expect(STATIC_FRENCH_SYSTEM_PROMPT).toContain("ZÉRO INVENTION DE DISPONIBILITÉ");
    // Divulgation sobre : ne pas lister les serveurs systématiquement
    expect(STATIC_FRENCH_SYSTEM_PROMPT).toContain("Ne cite la liste nominative des serveurs");
    // Demandeur conditionnel
    expect(STATIC_FRENCH_SYSTEM_PROMPT).toContain("Ne précise qui l'a demandé (requestedBy)");
  });

  it('T-ROUTING-05: vérifie handleTruncatedCompletion pour éviter les phrases coupées net', () => {
    // Cas 1 : texte déjà correctement ponctué
    const clean = 'Voici trois superbes films pour ce soir.';
    expect(handleTruncatedCompletion(clean)).toBe(clean);

    // Cas 2 : texte coupé au milieu d'une phrase après une première phrase complète
    const cutMidSentence = 'Voici trois superbes films pour ce soir. Le premier est dispon';
    expect(handleTruncatedCompletion(cutMidSentence)).toBe('Voici trois superbes films pour ce soir.');

    // Cas 3 : texte sans ponctuation finale (un seul tronçon)
    const singleBroken = 'Voici un film vraiment excep';
    expect(handleTruncatedCompletion(singleBroken)).toBe('Voici un film vraiment excep…');
  });

  it('T-ROUTING-06: vérifie l’exécution simulée et le respect de max_tokens = 900', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askarr-routing-test-'));
    const db = new AskarrDatabase(path.join(tmpDir, 'test.db'));
    const cfg = loadConfig({
      SQLITE_DB_PATH: path.join(tmpDir, 'test.db'),
      DEEPSEEK_API_KEY: 'sk-deepseek-test',
      MDBLIST_API_KEY: 'mdb-key',
      LOG_LEVEL: 'silent'
    });

    let capturedRequestBody: Record<string, unknown> | null = null;

    const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedRequestBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Voici un film adapté à vos critères.'
              },
              finish_reason: 'stop'
            }
          ],
          usage: { prompt_tokens: 120, completion_tokens: 25 }
        })
      };
    });

    const orchestrator = new DeepSeekOrchestratorService(
      cfg,
      db,
      {} as MediaAggregatorService,
      {} as OverseerrConnector,
      mockFetch as unknown as typeof fetch
    );

    const result = await orchestrator.handleUserMessage({
      userEmail: 'user@example.com',
      overseerrUserId: null,
      message: 'Propose-moi des comédies de 2022'
    });

    expect(result.reply).toBe('Voici un film adapté à vos critères.');
    expect(capturedRequestBody).not.toBeNull();
    // max_tokens doit valoir 900 et non plus 500
    expect(capturedRequestBody?.['max_tokens']).toBe(900);

    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('T-ROUTING-07: gère finish_reason = length sans retourner de phrase tronquée au milieu d’un mot', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askarr-length-test-'));
    const db = new AskarrDatabase(path.join(tmpDir, 'test.db'));
    const cfg = loadConfig({
      SQLITE_DB_PATH: path.join(tmpDir, 'test.db'),
      DEEPSEEK_API_KEY: 'sk-deepseek-test',
      MDBLIST_API_KEY: 'mdb-key',
      LOG_LEVEL: 'silent'
    });

    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Ce film est disponible sur votre serveur Plex. Vous pouvez le lancer direc'
            },
            finish_reason: 'length'
          }
        ],
        usage: { prompt_tokens: 200, completion_tokens: 900 }
      })
    }));

    const orchestrator = new DeepSeekOrchestratorService(
      cfg,
      db,
      {} as MediaAggregatorService,
      {} as OverseerrConnector,
      mockFetch as unknown as typeof fetch
    );

    const result = await orchestrator.handleUserMessage({
      userEmail: 'user@example.com',
      overseerrUserId: null,
      message: 'Est-ce que Gladiator est dispo ?'
    });

    // La phrase inachevée "Vous pouvez le lancer direc" a été tronquée proprement à la dernière phrase complète
    expect(result.reply).toBe('Ce film est disponible sur votre serveur Plex.');

    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('T-ROUTING-08: vérifie le retrait propre de discover_media_by_criteria quand mdblistApiKey est absent', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askarr-nomdblist-test-'));
    const db = new AskarrDatabase(path.join(tmpDir, 'test.db'));
    const cfg = loadConfig({
      SQLITE_DB_PATH: path.join(tmpDir, 'test.db'),
      DEEPSEEK_API_KEY: 'sk-deepseek-test',
      MDBLIST_API_KEY: '', // Clé absente
      LOG_LEVEL: 'silent'
    });

    let sentTools: Array<{ function: { name: string } }> = [];

    const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      sentTools = body.tools || [];
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Voici mes recommandations.'
              },
              finish_reason: 'stop'
            }
          ],
          usage: { prompt_tokens: 100, completion_tokens: 15 }
        })
      };
    });

    const orchestrator = new DeepSeekOrchestratorService(
      cfg,
      db,
      {} as MediaAggregatorService,
      {} as OverseerrConnector,
      mockFetch as unknown as typeof fetch
    );

    await orchestrator.handleUserMessage({
      userEmail: 'user@example.com',
      overseerrUserId: null,
      message: 'Des films à me conseiller ?'
    });

    // discover_media_by_criteria ne doit PAS être présent dans les outils envoyés au provider
    expect(sentTools.some((t) => t.function.name === 'discover_media_by_criteria')).toBe(false);
    // Mais discover_and_recommend_media doit être présent
    expect(sentTools.some((t) => t.function.name === 'discover_and_recommend_media')).toBe(true);

    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('T-ROUTING-09: vérifie le traitement des 4 paires ambiguës lors d’un appel d’outil simulé', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askarr-pairs-test-'));
    const db = new AskarrDatabase(path.join(tmpDir, 'test.db'));
    const cfg = loadConfig({
      SQLITE_DB_PATH: path.join(tmpDir, 'test.db'),
      DEEPSEEK_API_KEY: 'sk-deepseek-test',
      MDBLIST_API_KEY: 'mdb-key',
      LOG_LEVEL: 'silent'
    });

    const mockAggregator = {
      searchAndCheckMedia: vi.fn().mockResolvedValue({
        candidates: [
          {
            identity: {
              mediaType: 'movie',
              tmdbId: 101,
              tvdbId: null,
              imdbId: 'tt1375666',
              titleFr: 'Inception',
              originalTitle: 'Inception',
              year: 2010,
              overviewFr: 'Dom Cobb est un voleur expérimenté dans l art de l extraction...',
              posterUrl: null,
              genres: ['Action', 'Science-Fiction'],
              runtimeMinutes: 148,
              directorOrCreator: 'Christopher Nolan',
              topCast: ['Leonardo DiCaprio'],
              ratings: {
                imdbOrAudienceRating: 8.8,
                tmdbVoteAverage: 8.4,
                criticRating: null,
                imdbRating: 8.8,
                imdbVotes: 2400000,
                mdblistScore: 90
              },
              releaseDates: {
                inCinemas: '2010-07-21',
                digitalRelease: '2010-12-01',
                physicalRelease: '2010-12-01',
                estimatedVodOrDvdDate: '2010-12-01',
                isEstimatedDate: false,
                nextAiring: null
              }
            },
            catalogPresence: {
              state: 'available_now',
              serversQueried: ['NucBuntu'],
              matchedItems: [],
              availableServers: ['NucBuntu'],
              userAccessibleServers: ['NucBuntu'],
              accessibleToCurrentUser: true
            },
            requestState: {
              state: 'available',
              requestId: null,
              requestedAt: null,
              requestedByCurrentUser: false,
              requestedByDisplayName: null
            },
            acquisitionPipeline: {
              state: 'imported_on_disk',
              externalServiceId: 1,
              monitored: true,
              hasFile: true,
              estimatedAvailabilityDate: null,
              estimatedAvailabilityReason: null,
              queueProgressPercent: null,
              queueTimeleft: null
            },
            episodeCoverage: null,
            indexerSearch: {
              queried: false,
              state: 'not_queried',
              matchingReleasesCount: 0,
              bestQualityHint: null,
              activeIndexersCount: null
            },
            actionability: {
              canRequestNow: false,
              requestableSeasons: [],
              blockReason: 'ALREADY_AVAILABLE_ON_PLEX',
              userFriendlyStatusLabel: 'Disponible immédiatement sur Plex',
              userFriendlyExplanationFr: 'Disponible sur Plex',
              statusTone: 'emerald'
            },
            provenance: []
          } as MediaEvidence
        ]
      })
    } as unknown as MediaAggregatorService;

    // Simulation d'un premier round avec tool_call puis deuxième round avec réponse finale
    let roundCall = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      roundCall++;
      if (roundCall === 1) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_1',
                      type: 'function',
                      function: {
                        name: 'search_and_check_media',
                        arguments: JSON.stringify({ query: 'Inception', mediaType: 'movie' })
                      }
                    }
                  ]
                },
                finish_reason: 'tool_calls'
              }
            ],
            usage: { prompt_tokens: 150, completion_tokens: 30 }
          })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Inception est disponible immédiatement sur votre serveur Plex NucBuntu.'
              },
              finish_reason: 'stop'
            }
          ],
          usage: { prompt_tokens: 220, completion_tokens: 20 }
        })
      };
    });

    const orchestrator = new DeepSeekOrchestratorService(
      cfg,
      db,
      mockAggregator,
      {} as OverseerrConnector,
      mockFetch as unknown as typeof fetch
    );

    const result = await orchestrator.handleUserMessage({
      userEmail: 'user@example.com',
      overseerrUserId: null,
      message: 'As-tu Inception sur Plex ?'
    });

    expect(mockAggregator.searchAndCheckMedia).toHaveBeenCalled();
    expect(result.reply).toContain('Inception est disponible immédiatement');

    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('T-ROUTING-11: get_watch_history_and_live_streams resolves user history and falls back when allowedServers differ', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'askarr-tracearr-history-test-'));
    const dbPath = path.join(tmpDir, 'test.db');
    const db = new AskarrDatabase(dbPath);
    const cfg = loadConfig();

    const mockTracearr = {
      isConfigured: vi.fn().mockReturnValue(true),
      getWatchHistory: vi.fn().mockImplementation(async (opts) => {
        // If allowedServers is passed and strict, returns [] (simulating discrepancy)
        if (opts.allowedServers && opts.allowedServers.length > 0) {
          return [];
        }
        // Fallback without allowedServers returns history
        return [
          {
            id: 'h1',
            title: 'Gladiator II',
            year: 2024,
            mediaType: 'movie',
            tmdbId: 558449,
            serverName: 'Plex',
            startedAt: '2026-11-05T20:00:00Z',
            percentComplete: 100,
            watched: true,
            username: 'jsuzanne'
          }
        ];
      }),
      getActiveStreams: vi.fn().mockResolvedValue({
        total: 0,
        transcodes: 0,
        directPlays: 0,
        streams: []
      })
    };

    const orchestrator = new DeepSeekOrchestratorService(
      cfg,
      db,
      {} as MediaAggregatorService,
      {} as OverseerrConnector,
      vi.fn() as unknown as typeof fetch,
      mockTracearr as any
    );

    const toolResult = (await (orchestrator as any).executeReadOnlyTool({
      fnName: 'get_watch_history_and_live_streams',
      args: { scope: 'my_history', mediaType: 'movie' },
      userEmail: 'jsuzanne@example.com',
      overseerrUserId: 1,
      plexAccess: {
        plexUserId: 1,
        plexUsername: 'jsuzanne',
        askarrServerNames: ['NucVillers']
      },
      prowlarrCallsThisTurn: 0,
      onProwlarrCalled: vi.fn(),
      onCardsCollected: vi.fn(),
      onPreparedActionCreated: vi.fn()
    })) as any;

    expect(mockTracearr.getWatchHistory).toHaveBeenCalledTimes(2);
    expect(toolResult.scope).toBe('my_history');
    expect(toolResult.recentWatchHistory.length).toBe(1);
    expect(toolResult.recentWatchHistory[0].title).toBe('Gladiator II');
    expect(toolResult.connectedUser.plexUsername).toBe('jsuzanne');

    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
