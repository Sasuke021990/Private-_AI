import { prisma } from '../db';

class RevokedTokenManager {
  private revoked = new Set<string>();

  public async load(): Promise<void> {
    try {
      await prisma.revokedToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      const rows = await prisma.revokedToken.findMany({ select: { jti: true } });
      this.revoked = new Set(rows.map(r => r.jti));
    } catch (error) {
      console.error('Failed to load revoked tokens from DB:', error);
    }
  }

  public async revoke(jti: string | undefined, expiresAt: Date): Promise<void> {
    if (!jti) return;
    this.revoked.add(jti);
    try {
      await prisma.revokedToken.upsert({
        where: { jti },
        update: {},
        create: { jti, expiresAt },
      });
    } catch (error) {
      console.error('Failed to persist revoked token:', error);
    }
  }

  // Set lookup only — no DB hit on the hot path (every proxied request/WS upgrade goes through this).
  public isRevoked(jti: string | undefined): boolean {
    return !!jti && this.revoked.has(jti);
  }
}

export const revokedTokenManager = new RevokedTokenManager();
