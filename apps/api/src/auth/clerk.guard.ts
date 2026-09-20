import {
  CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { verifyToken } from '@clerk/backend';
import { sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { Database } from '@india-voice/database';
import { DATABASE } from '../database.token';
import { APP_CONFIG } from '../config.token';
import type { AppConfig } from '../config';

export interface AuthenticatedUser {
  organizationId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  clerkUserId: string;
  clerkIssuer: string;
}

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest & { user?: AuthenticatedUser }>();
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing authorization token');
    }
    const token = authHeader.slice(7);

    let payload: { sub: string; iss: string };
    try {
      payload = await verifyToken(token, { secretKey: this.config.CLERK_SECRET_KEY ?? '' });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    type Row = { organization_id: string; user_id: string; user_role: string };
    const result = await this.db.execute(
      sql`SELECT organization_id, user_id, user_role FROM resolve_tenant_identity(${payload.iss}, ${payload.sub})`,
    );
    const row = result.rows[0] as Row | undefined;
    if (!row) throw new UnauthorizedException('user_not_provisioned');

    request.user = {
      organizationId: row.organization_id,
      userId: row.user_id,
      role: row.user_role as AuthenticatedUser['role'],
      clerkUserId: payload.sub,
      clerkIssuer: payload.iss,
    };
    return true;
  }
}
