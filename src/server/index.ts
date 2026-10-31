import { loadConfig } from './config/env.js';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';

async function main() {
  const config = loadConfig();
  const { app } = await createApp({ config });

  await app.listen({
    host: '0.0.0.0',
    port: config.port
  });

  logger.info(
    {
      port: config.port,
      nodeEnv: config.nodeEnv,
      plexServers: config.plexServers.map((s) => `${s.name}(${s.baseUrl})`),
      aiEnabled: Boolean(config.deepseekApiKey)
    },
    'Serveur Askarr démarré avec succès'
  );
}

main().catch((err) => {
  console.error('Échec critique au démarrage de Askarr :', err);
  process.exit(1);
});
