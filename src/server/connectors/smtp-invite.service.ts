import tls from 'node:tls';
import type { AskarrDatabase } from '../db/database.js';
import type { ApiTracer } from '../utils/api-tracer.js';
import type { SmtpSettingsDTO } from '../../shared/types.js';

export interface SmtpConfigInternal {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpAppPassword: string;
  senderName: string;
  publicAppUrl: string;
}

export class SmtpInviteService {
  constructor(
    private readonly db: AskarrDatabase,
    private readonly defaultAdminEmail: string,
    private readonly apiTracer?: ApiTracer
  ) {}

  public getConfig(): SmtpConfigInternal {
    const smtpHost = (
      this.db.getAppSetting('smtp_host') ||
      process.env.SMTP_HOST ||
      'smtp.gmail.com'
    ).trim();

    const smtpPort =
      Number(this.db.getAppSetting('smtp_port') || process.env.SMTP_PORT || 465) || 465;

    const smtpUser = (
      this.db.getAppSetting('smtp_user') ||
      process.env.SMTP_USER ||
      this.defaultAdminEmail ||
      ''
    ).trim();

    const smtpAppPassword = (
      this.db.getAppSetting('smtp_app_password') ||
      process.env.GOOGLE_MAIL_APP_KEY ||
      process.env.SMTP_APP_PASSWORD ||
      ''
    ).replace(/\s+/g, '');

    const senderName = (
      this.db.getAppSetting('smtp_sender_name') ||
      process.env.SMTP_SENDER_NAME ||
      'Askarr · Grand Cinéma Plex'
    ).trim();

    const publicAppUrl = (
      this.db.getAppSetting('public_app_url') ||
      process.env.PUBLIC_APP_URL ||
      ''
    ).trim();

    return {
      smtpHost,
      smtpPort,
      smtpUser,
      smtpAppPassword,
      senderName,
      publicAppUrl
    };
  }

  public getPublicSummary(): SmtpSettingsDTO {
    const cfg = this.getConfig();
    return {
      smtpHost: cfg.smtpHost,
      smtpPort: cfg.smtpPort,
      smtpUser: cfg.smtpUser,
      hasSmtpPassword: Boolean(cfg.smtpAppPassword),
      smtpConfigured: Boolean(cfg.smtpHost && cfg.smtpUser && cfg.smtpAppPassword),
      senderName: cfg.senderName,
      publicAppUrl: cfg.publicAppUrl
    };
  }

  public updateSettings(partial: {
    smtpHost?: string;
    smtpPort?: number;
    smtpUser?: string;
    smtpAppPassword?: string;
    senderName?: string;
    publicAppUrl?: string;
  }): SmtpSettingsDTO {
    if (typeof partial.smtpHost === 'string' && partial.smtpHost.trim()) {
      this.db.setAppSetting('smtp_host', partial.smtpHost.trim());
    }
    if (typeof partial.smtpPort === 'number' && partial.smtpPort > 0) {
      this.db.setAppSetting('smtp_port', String(partial.smtpPort));
    }
    if (typeof partial.smtpUser === 'string') {
      this.db.setAppSetting('smtp_user', partial.smtpUser.trim());
    }
    if (typeof partial.smtpAppPassword === 'string') {
      const cleaned = partial.smtpAppPassword.replace(/\s+/g, '');
      if (cleaned && !cleaned.includes('••••')) {
        this.db.setAppSetting('smtp_app_password', cleaned);
      }
    }
    if (typeof partial.senderName === 'string' && partial.senderName.trim()) {
      this.db.setAppSetting('smtp_sender_name', partial.senderName.trim());
    }
    if (typeof partial.publicAppUrl === 'string') {
      this.db.setAppSetting('public_app_url', partial.publicAppUrl.trim());
    }
    return this.getPublicSummary();
  }

  public async sendInvitationEmail(params: {
    recipientEmail: string;
    recipientName?: string | null;
    plexServers?: string[];
    fallbackOrigin?: string;
    customMessage?: string;
  }): Promise<{ sent: boolean; appUrl: string; latencyMs: number }> {
    const cfg = this.getConfig();
    if (!cfg.smtpHost || !cfg.smtpUser || !cfg.smtpAppPassword) {
      throw new Error(
        "Configuration SMTP incomplète : renseigne ton adresse Gmail et le Mot de passe d'application Google (16 caractères) dans le panneau SMTP."
      );
    }

    const recipientEmail = params.recipientEmail.trim().toLowerCase();
    const appUrl = cfg.publicAppUrl || params.fallbackOrigin || 'http://localhost:4880';
    const displayName = params.recipientName?.trim() || recipientEmail.split('@')[0];
    const serversBadgeHtml =
      params.plexServers && params.plexServers.length > 0
        ? `<div style="margin:16px 0;padding:12px 16px;background-color:#171014;border:1px solid rgba(234,179,8,0.28);border-radius:12px;font-size:13px;color:#fef3c7;">
             🎬 <strong>Tes serveurs Plex rattachés :</strong> ${params.plexServers.join(' · ')}
           </div>`
        : '';

    const customNoteHtml = params.customMessage?.trim()
      ? `<div style="margin:16px 0;padding:14px 16px;background-color:#1f1318;border-left:3px solid #e11d48;border-radius:8px;font-size:14px;color:#fce7f3;font-style:italic;">
           « ${params.customMessage.trim()} »
         </div>`
      : '';

    const subject = '🎬 Billet d’Invitation VIP — Askarr · Concierge Grand Cinéma Plex';
    const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
    const senderDisplay = cfg.senderName || 'Askarr · Grand Cinéma Plex';
    const encodedSender = `=?UTF-8?B?${Buffer.from(senderDisplay, 'utf8').toString('base64')}?=`;

    const htmlBody = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:24px;background-color:#090608;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#f5f0e6;">
  <div style="max-width:540px;margin:0 auto;background:linear-gradient(165deg,#181115 0%,#0d090c 100%);border:1px solid rgba(234,179,8,0.35);border-radius:20px;padding:32px;box-shadow:0 20px 50px rgba(0,0,0,0.8);">
    <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#eab308;font-weight:700;margin-bottom:8px;">
      ★ BILLET D'INVITATION VIP · GRAND CINÉMA PLEX ★
    </div>
    <h1 style="margin:0 0 14px 0;font-size:24px;color:#fffdf9;letter-spacing:0.5px;">
      Bienvenue dans la salle Askarr, ${displayName} !
    </h1>
    <p style="font-size:15px;line-height:1.65;color:#d6d1c7;margin:0 0 18px 0;">
      Ton adresse <strong style="color:#fde68a;">${recipientEmail}</strong> dispose désormais d'un accès coupe-file à <strong>Askarr</strong>, le concierge IA cinéma &amp; séries relié aux serveurs Plex.
    </p>
    ${serversBadgeHtml}
    ${customNoteHtml}
    <ul style="font-size:14px;line-height:1.7;color:#d6d1c7;padding-left:20px;margin:16px 0 24px 0;">
      <li>Vérifie instantanément si un film ou une série est disponible sur ton serveur Plex</li>
      <li>Retrouve un film même avec quelques indices (acteur, réalisateur, intrigue, festival)</li>
      <li>Demande l'ajout automatique d'un film ou d'une saison en 1 clic</li>
    </ul>
    <div style="margin:28px 0;text-align:center;">
      <a href="${appUrl}" style="display:inline-block;background:linear-gradient(135deg,#eab308 0%,#ca8a04 100%);color:#090608;font-weight:800;font-size:15px;text-decoration:none;padding:14px 32px;border-radius:12px;letter-spacing:0.5px;">
        Entrer dans la Salle Askarr →
      </a>
    </div>
    <div style="background-color:#120d10;border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:18px;font-size:13px;color:#d6d1c7;line-height:1.6;">
      <strong style="color:#fde68a;display:block;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;font-size:11px;">Comment te connecter :</strong>
      1. Clique sur <a href="${appUrl}" style="color:#eab308;font-weight:600;">${appUrl}</a><br/>
      2. Sur le portail de sécurité <strong>Cloudflare Access</strong>, connecte-toi avec <strong>Google</strong> (${recipientEmail}) ou saisis ton adresse pour recevoir un <strong>code PIN à 6 chiffres</strong> par email.<br/>
      3. <strong>Astuce iPhone :</strong> dans Safari, touche <em>Partager → Sur l'écran d'accueil</em> pour installer Askarr comme une application plein écran.
    </div>
  </div>
</body>
</html>`;

    const t0 = Date.now();
    try {
      await this.sendRawSmtpMail({
        host: cfg.smtpHost,
        port: cfg.smtpPort || 465,
        user: cfg.smtpUser,
        pass: cfg.smtpAppPassword,
        fromHeader: `${encodedSender} <${cfg.smtpUser}>`,
        fromEnvelope: cfg.smtpUser,
        toEnvelope: recipientEmail,
        subjectHeader: encodedSubject,
        htmlBody
      });

      const latencyMs = Date.now() - t0;
      this.apiTracer?.record({
        service: 'smtp',
        serverLabel: `${cfg.smtpHost}:${cfg.smtpPort}`,
        method: 'SMTPS',
        url: `smtps://${cfg.smtpHost}:${cfg.smtpPort}/send`,
        statusCode: 250,
        ok: true,
        latencyMs,
        requestSummary: `To: ${recipientEmail}`,
        responseSummary: `250 OK (Invitation VIP envoyée)`
      });

      return { sent: true, appUrl, latencyMs };
    } catch (err) {
      const latencyMs = Date.now() - t0;
      const errMsg = err instanceof Error ? err.message : 'SMTP_ERROR';
      this.apiTracer?.record({
        service: 'smtp',
        serverLabel: `${cfg.smtpHost}:${cfg.smtpPort}`,
        method: 'SMTPS',
        url: `smtps://${cfg.smtpHost}:${cfg.smtpPort}/send`,
        statusCode: 500,
        ok: false,
        latencyMs,
        requestSummary: `To: ${recipientEmail}`,
        error: errMsg
      });
      throw err;
    }
  }

  private sendRawSmtpMail(params: {
    host: string;
    port: number;
    user: string;
    pass: string;
    fromHeader: string;
    fromEnvelope: string;
    toEnvelope: string;
    subjectHeader: string;
    htmlBody: string;
  }): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = tls.connect(
        {
          host: params.host,
          port: params.port,
          servername: params.host,
          rejectUnauthorized: true
        },
        () => {
          // Connected over implicit TLS (port 465)
        }
      );

      socket.setTimeout(15000);
      let buffer = '';
      let step = 0;
      let finished = false;

      const fail = (err: Error) => {
        if (finished) return;
        finished = true;
        try {
          socket.destroy();
        } catch {
          // ignore
        }
        reject(err);
      };

      const sendLine = (line: string) => {
        socket.write(`${line}\r\n`);
      };

      socket.on('timeout', () =>
        fail(new Error('Délai dépassé lors de la connexion au serveur SMTP (port 465)'))
      );
      socket.on('error', (err) => fail(err));

      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\r\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line) continue;
          if (line.length >= 4 && line[3] === '-') {
            continue;
          }
          const code = Number(line.slice(0, 3));
          if (code >= 400) {
            fail(new Error(`Erreur SMTP (${code}): ${line}`));
            return;
          }

          if (step === 0 && code === 220) {
            step = 1;
            sendLine('EHLO askarr.local');
          } else if (step === 1 && code === 250) {
            step = 2;
            sendLine('AUTH LOGIN');
          } else if (step === 2 && code === 334) {
            step = 3;
            sendLine(Buffer.from(params.user, 'utf8').toString('base64'));
          } else if (step === 3 && code === 334) {
            step = 4;
            sendLine(Buffer.from(params.pass, 'utf8').toString('base64'));
          } else if (step === 4 && code === 235) {
            step = 5;
            sendLine(`MAIL FROM:<${params.fromEnvelope}>`);
          } else if (step === 5 && code === 250) {
            step = 6;
            sendLine(`RCPT TO:<${params.toEnvelope}>`);
          } else if (step === 6 && (code === 250 || code === 251)) {
            step = 7;
            sendLine('DATA');
          } else if (step === 7 && code === 354) {
            step = 8;
            const b64Html =
              Buffer.from(params.htmlBody, 'utf8')
                .toString('base64')
                .match(/.{1,76}/g)
                ?.join('\r\n') || '';
            const message = [
              `From: ${params.fromHeader}`,
              `To: <${params.toEnvelope}>`,
              `Subject: ${params.subjectHeader}`,
              `Date: ${new Date().toUTCString()}`,
              'MIME-Version: 1.0',
              'Content-Type: text/html; charset=UTF-8',
              'Content-Transfer-Encoding: base64',
              '',
              b64Html,
              '.'
            ].join('\r\n');
            sendLine(message);
          } else if (step === 8 && code === 250) {
            step = 9;
            finished = true;
            sendLine('QUIT');
            socket.end();
            resolve();
          }
        }
      });
    });
  }
}
