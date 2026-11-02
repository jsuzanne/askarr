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

    // Numéro de série déterministe style billet vintage (ex: N° 087481-B)
    const serialHash = Array.from(recipientEmail).reduce(
      (acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 900000,
      100000
    );
    const ticketSerial = `N° ${String(serialHash).padStart(6, '0')}-B`;

    const serversBadgeHtml =
      params.plexServers && params.plexServers.length > 0
        ? `<div style="margin:0 0 12px 0;padding:8px 12px;background-color:#fdf6e4;border:1px solid #8c2d19;border-radius:8px;font-size:12px;color:#261710;">
             🎞️ <strong style="color:#8c2d19;">Serveurs Plex :</strong> ${params.plexServers.join(' · ')}
           </div>`
        : '';

    const customNoteHtml = params.customMessage?.trim()
      ? `<div style="margin:0 0 12px 0;padding:10px 12px;background-color:#fdf6e4;border-left:3px solid #8c2d19;border-radius:6px;font-size:13px;color:#382419;font-style:italic;">
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
<body style="margin:0;padding:20px 12px;background-color:#140d0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#261710;">
  <div style="max-width:630px;margin:0 auto;background-color:#f3e3c3;border:2px solid #261710;border-radius:16px;overflow:hidden;box-shadow:0 20px 45px rgba(0,0,0,0.75);">
    <!-- Bande pellicule supérieure -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#261710;color:#f3e3c3;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:11px;letter-spacing:2px;">
      <tr>
        <td style="padding:7px 16px;white-space:nowrap;">▪ ▪ ▪ ▪ &nbsp;GRAND CINÉMA PLEX · SALLE ASKARR&nbsp; ▪ ▪ ▪ ▪</td>
        <td align="right" style="padding:7px 16px;white-space:nowrap;color:#eab308;font-weight:700;">35MM · VIP</td>
      </tr>
    </table>

    <div style="padding:18px;">
      <!-- Double cadre intérieur type ticket vintage avec souche détachable -->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:2px solid #261710;border-radius:12px;overflow:hidden;background-color:#f3e3c3;">
        <tr>
          <!-- Partie principale du billet (Gauche) -->
          <td valign="top" style="padding:18px 20px;background-color:#f3e3c3;">
            <!-- Barre supérieure garantie sur 1 seule ligne -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:2px solid rgba(38,23,16,0.22);padding-bottom:8px;margin-bottom:14px;">
              <tr>
                <td style="font-size:11px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#8c2d19;white-space:nowrap;">
                  ★ BILLET D'INVITATION VIP ★
                </td>
                <td align="right" style="white-space:nowrap;">
                  <span style="display:inline-block;background-color:#ead2a8;border:1px solid #8c2d19;border-radius:4px;padding:2px 7px;font-size:10px;font-weight:800;letter-spacing:1px;color:#8c2d19;text-transform:uppercase;">
                    ACCÈS ILLIMITÉ
                  </span>
                </td>
              </tr>
            </table>

            <!-- Cartouche Invité(e) avec GRAND BLASON CINÉMA VINTAGE (82x82px) -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:14px;">
              <tr>
                <td width="86" valign="middle" style="padding-right:14px;">
                  <table role="presentation" width="84" cellpadding="0" cellspacing="0" border="0" style="width:84px;height:84px;background-color:#fdf6e4;border:2px solid #261710;outline:2px solid #8c2d19;border-radius:12px;text-align:center;">
                    <tr>
                      <td align="center" style="padding-top:4px;font-size:10px;font-weight:900;letter-spacing:2px;color:#8c2d19;line-height:1;white-space:nowrap;">
                        &#9733; &#9733; &#9733;
                      </td>
                    </tr>
                    <tr>
                      <td align="center" style="font-size:36px;line-height:1.05;padding:2px 0;">
                        🎬
                      </td>
                    </tr>
                    <tr>
                      <td align="center" style="padding:0 5px 5px 5px;">
                        <div style="background-color:#8c2d19;color:#fdf6e4;font-size:9px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;border-radius:4px;padding:2px 0;line-height:1.1;white-space:nowrap;">
                          CINÉMA
                        </div>
                      </td>
                    </tr>
                  </table>
                </td>
                <td valign="middle">
                  <div style="display:inline-block;background-color:#e8d3ab;border:1px solid rgba(38,23,16,0.3);border-radius:4px;padding:2px 8px;font-size:10px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:#8c2d19;margin-bottom:4px;">
                    🎟️ INVITÉ(E) D'HONNEUR
                  </div>
                  <div style="font-size:22px;font-weight:900;color:#261710;letter-spacing:-0.3px;line-height:1.15;">
                    ${displayName}
                  </div>
                  <div style="font-size:12px;font-weight:600;color:#5c3e2e;margin-top:2px;">
                    Salle Privée Askarr · Concierge IA Plex
                  </div>
                </td>
              </tr>
            </table>

            <p style="font-size:13px;line-height:1.55;color:#382419;margin:0 0 12px 0;">
              Ton compte <a href="mailto:${recipientEmail}" style="color:#8c2d19 !important;font-weight:800;text-decoration:underline;">${recipientEmail}</a> dispose d'un accès coupe-file à <strong>Askarr</strong>, le concierge IA relié aux serveurs Plex.
            </p>

            ${serversBadgeHtml}
            ${customNoteHtml}

            <!-- 3 puces courtes calibrées pour tenir sur 1 seule ligne chacune -->
            <div style="background-color:#e8d3ab;border:1px solid rgba(38,23,16,0.38);border-radius:8px;padding:10px 12px;margin:0 0 16px 0;font-size:12px;line-height:1.75;color:#261710;">
              <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                <span style="color:#8c2d19;font-weight:900;">✓</span>&nbsp; <strong>Disponibilité immédiate</strong> sur tes serveurs Plex
              </div>
              <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                <span style="color:#8c2d19;font-weight:900;">✓</span>&nbsp; <strong>Recherche intelligente</strong> (acteur, intrigue, festival)
              </div>
              <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                <span style="color:#8c2d19;font-weight:900;">✓</span>&nbsp; <strong>Ajout automatique</strong> d'un film ou d'une série en 1 clic
              </div>
            </div>

            <div>
              <a href="${appUrl}" style="display:inline-block;background-color:#8c2d19;color:#fdf6e7 !important;font-weight:800;font-size:13px;text-decoration:none;padding:10px 20px;border-radius:8px;border:2px solid #261710;">
                🎟️ Entrer dans la Salle Askarr &rarr;
              </a>
            </div>
          </td>

          <!-- Talon détachable perforé (Droite) avec Médaillon Projecteur -->
          <td width="165" valign="middle" align="center" style="width:165px;background-color:#ead6ae;border-left:2px dashed #261710;padding:16px 12px;text-align:center;">
            <div style="font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:#6e503b;margin-bottom:10px;">
              COUPE-FILE
            </div>

            <!-- Médaillon Projecteur Cinéma dans le talon -->
            <div style="width:48px;height:48px;line-height:48px;margin:0 auto 12px auto;background-color:#fdf6e4;border:2px solid #261710;border-radius:999px;font-size:24px;text-align:center;">
              📽️
            </div>

            <div style="border-top:2px solid #261710;border-bottom:2px solid #261710;padding:5px 4px;font-size:16px;font-weight:900;letter-spacing:2px;color:#261710;white-space:nowrap;">
              ADMIT ONE
            </div>
            <div style="font-size:11px;font-weight:800;letter-spacing:1px;color:#8c2d19;margin-top:5px;margin-bottom:16px;">
              FAUTEUIL VIP
            </div>

            <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:11px;font-weight:700;letter-spacing:1px;color:#261710;background-color:#f3e3c3;border:1px solid rgba(38,23,16,0.45);border-radius:4px;padding:4px 6px;margin-bottom:6px;white-space:nowrap;">
              ${ticketSerial}
            </div>
            <div style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;letter-spacing:-1px;color:#261710;line-height:1;">
              ||| || |||| | ||| |||| ||
            </div>
          </td>
        </tr>
      </table>

      <!-- Pied explicatif compact et net -->
      <div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(38,23,16,0.22);font-size:12px;line-height:1.6;color:#4a3223;">
        <div>
          <strong>1. Connexion :</strong> Ouvre <a href="${appUrl}" style="color:#8c2d19 !important;font-weight:800;text-decoration:underline;">${appUrl}</a> et connecte-toi via <strong>Google</strong> (${recipientEmail}) ou code PIN email.
        </div>
        <div>
          <strong>2. Astuce iPhone :</strong> Dans Safari, touche <em>Partager &rarr; Sur l'écran d'accueil</em> pour l'avoir en plein écran.
        </div>
      </div>
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
