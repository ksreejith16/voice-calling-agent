import {
  Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe,
  Patch, Post, UseGuards,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import type { Database } from '@india-voice/database';
import { agentConfigs, supportedLanguage } from '@india-voice/database';
import { withTenantTransaction } from '@india-voice/database';
import { ClerkAuthGuard } from '../auth/clerk.guard';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { DATABASE } from '../database.token';

interface CreateAgentBody {
  name: string;
  description?: string;
  language?: string;
  voice?: string;
  instructions?: string;
  openingMessage?: string;
}

@Controller('agents')
@UseGuards(ClerkAuthGuard)
export class AgentsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    return withTenantTransaction(this.db, user.organizationId, (tx) =>
      tx.select().from(agentConfigs)
        .where(and(
          eq(agentConfigs.organizationId, user.organizationId),
          eq(agentConfigs.status, 'active'),
        ))
        .orderBy(agentConfigs.createdAt),
    );
  }

  @Get(':id')
  async get(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    const [row] = await withTenantTransaction(this.db, user.organizationId, (tx) =>
      tx.select().from(agentConfigs)
        .where(and(eq(agentConfigs.organizationId, user.organizationId), eq(agentConfigs.id, id)))
        .limit(1),
    );
    return row ?? null;
  }

  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateAgentBody) {
    const [row] = await withTenantTransaction(this.db, user.organizationId, (tx) =>
      tx.insert(agentConfigs).values({
        organizationId: user.organizationId,
        name: body.name?.trim() ?? '',
        description: body.description?.trim() ?? '',
        language: (body.language as typeof agentConfigs.$inferInsert['language']) ?? 'en-IN',
        voice: body.voice?.trim() || null,
        instructions: body.instructions?.trim() ?? '',
        openingMessage: body.openingMessage?.trim() ?? '',
      }).returning(),
    );
    return row;
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Partial<CreateAgentBody>,
  ) {
    const [row] = await withTenantTransaction(this.db, user.organizationId, (tx) =>
      tx.update(agentConfigs)
        .set({
          ...(body.name !== undefined && { name: body.name.trim() }),
          ...(body.description !== undefined && { description: body.description.trim() }),
          ...(body.language !== undefined && { language: body.language as typeof agentConfigs.$inferInsert['language'] }),
          ...(body.voice !== undefined && { voice: body.voice.trim() || null }),
          ...(body.instructions !== undefined && { instructions: body.instructions.trim() }),
          ...(body.openingMessage !== undefined && { openingMessage: body.openingMessage.trim() }),
          updatedAt: new Date(),
        })
        .where(and(eq(agentConfigs.organizationId, user.organizationId), eq(agentConfigs.id, id)))
        .returning(),
    );
    return row ?? null;
  }

  @Delete(':id')
  async archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await withTenantTransaction(this.db, user.organizationId, (tx) =>
      tx.update(agentConfigs)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(and(eq(agentConfigs.organizationId, user.organizationId), eq(agentConfigs.id, id))),
    );
    return { archived: true };
  }
}
