import { describe, it, expect } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { AskarrDatabase } from '../../src/server/db/database.js';

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

    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
