import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AppConfig } from '../config/env.js';
import type { UserRole } from '../../shared/types.js';

export interface AuthenticatedPrincipal {
  email: string;
  role: UserRole;
  authSource: 'cloudflare_jwt' | 'dev_header';
}

export class CloudflareAuthVerifier {
  private jwks?: JWTVerifyGetKey;
  private readonly hasCustomJwks: boolean;

  constructor(
    private readonly config: AppConfig,
    customJwks?: JWTVerifyGetKey
  ) {
    this.hasCustomJwks = Boolean(customJwks);
    if (customJwks) {
      this.jwks = customJwks;
    } else if (config.cfAccessTeamDomain) {
      const certsUrl = new URL(`https://${config.cfAccessTeamDomain}/cdn-cgi/access/certs`);
      this.jwks = createRemoteJWKSet(certsUrl);
    }
  }

  public resolveRole(email: string): UserRole {
    const normalized = email.trim().toLowerCase();
    return this.config.adminEmails.includes(normalized) ? 'admin' : 'friend';
  }

  public async verifyRequest(req: FastifyRequest): Promise<AuthenticatedPrincipal> {
    const jwtAssertion = req.headers['cf-access-jwt-assertion'];
    const token = Array.isArray(jwtAssertion) ? jwtAssertion[0] : jwtAssertion;

    if (token && token.trim().length > 0) {
      if (!this.jwks && this.config.cfAccessTeamDomain) {
        const certsUrl = new URL(`https://${this.config.cfAccessTeamDomain}/cdn-cgi/access/certs`);
        this.jwks = createRemoteJWKSet(certsUrl);
      }
      if (!this.jwks) {
        throw new AuthError('CF_JWKS_NOT_CONFIGURED', 'Domaine JWKS Cloudflare Access non configuré.', 401);
      }

      try {
        const verifyOptions: { audience?: string } = {};
        if (this.config.cfAccessAud) {
          verifyOptions.audience = this.config.cfAccessAud;
        }
        let payload: Record<string, unknown>;
        try {
          const verified = await jwtVerify(token, this.jwks, verifyOptions);
          payload = verified.payload as Record<string, unknown>;
        } catch (innerErr) {
          // Si l'utilisateur vient de créer une nouvelle application Cloudflare Access pour Askarr
          // dont le tag AUD diffère de l'AUD par défaut, on vérifie quand même la signature JWKS du domaine Cloudflare
          if (!this.hasCustomJwks && verifyOptions.audience) {
            const verifiedWithoutAud = await jwtVerify(token, this.jwks);
            payload = verifiedWithoutAud.payload as Record<string, unknown>;
          } else {
            throw innerErr;
          }
        }
        const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
        if (!email) {
          throw new AuthError('CF_JWT_MISSING_EMAIL', 'Le jeton Cloudflare Access ne contient pas de champ email.', 401);
        }
        return {
          email,
          role: this.resolveRole(email),
          authSource: 'cloudflare_jwt'
        };
      } catch (err) {
        if (err instanceof AuthError) throw err;
        throw new AuthError('CF_JWT_INVALID', 'Jeton Cloudflare Access invalide, expiré ou audience incorrecte.', 401);
      }
    }

    // Header injecté par cloudflared (comme sur Transistor)
    const cfEmailHeader = req.headers['cf-access-authenticated-user-email'];
    const rawCfEmail = Array.isArray(cfEmailHeader) ? cfEmailHeader[0] : cfEmailHeader;
    if (rawCfEmail && rawCfEmail.trim().length > 0) {
      const email = rawCfEmail.trim().toLowerCase();
      return {
        email,
        role: this.resolveRole(email),
        authSource: 'cloudflare_jwt'
      };
    }

    // Fallback de développement local (strictement bloqué en production par loadConfig + double garde ici)
    if (this.config.nodeEnv !== 'production' && this.config.allowDevAuthHeader) {
      const devHeader = req.headers['x-dev-user-email'];
      const rawDevEmail = Array.isArray(devHeader) ? devHeader[0] : devHeader;
      const email = (rawDevEmail || this.config.devDefaultUserEmail).trim().toLowerCase();
      if (email) {
        return {
          email,
          role: this.resolveRole(email),
          authSource: 'dev_header'
        };
      }
    }

    // Mode LAN Homelab (comme Transistor sur NucVillers : accès direct LAN sans header Cloudflare -> compte Admin propriétaire)
    if (process.env.ALLOW_LAN_ADMIN_FALLBACK === 'true') {
      const fallbackAdmin = (this.config.adminEmails[0] || this.config.devDefaultUserEmail || '').trim().toLowerCase();
      if (fallbackAdmin) {
        return {
          email: fallbackAdmin,
          role: 'admin',
          authSource: 'dev_header'
        };
      }
    }

    throw new AuthError('AUTH_REQUIRED', 'Authentification Cloudflare Access requise (Cf-Access-Jwt-Assertion manquant).', 401);
  }
}

export class AuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 401
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export function requireAdmin(principal: AuthenticatedPrincipal, reply: FastifyReply): boolean {
  if (principal.role !== 'admin') {
    reply.code(403).send({
      error: 'FORBIDDEN_ADMIN_ONLY',
      message: 'Cette opération est strictement réservée à l’administrateur.'
    });
    return false;
  }
  return true;
}
