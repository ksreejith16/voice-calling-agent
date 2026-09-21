import {
  BadRequestException, ForbiddenException, NotFoundException, Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe,
  Patch, Post, UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import type { Database } from '@india-voice/database';
import { agentConfigs, supportedLanguage } from '@india-voice/database';
import { withTenantTransaction } from '@india-voice/database';
import { ClerkAuthGuard } from '../auth/clerk.guard';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { DATABASE } from '../database.token';

export const agentInput = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  language: z.enum(['te-IN', 'hi-IN', 'en-IN', 'te-en']).optional(),
  voice: z.enum(['shubh', 'aditya', 'ritu', 'priya', 'neha', 'rahul', 'pooja', 'simran']).optional(),
  instructions: z.string().trim().max(12000).optional(),
  openingMessage: z.string().trim().max(1000).optional(),
}).strict();
type CreateAgentBody = z.infer<typeof agentInput>;
function writable(user: AuthenticatedUser) {
  if (user.role === 'viewer') throw new ForbiddenException('Viewers cannot change agents');
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
    if (!row) throw new NotFoundException('Agent not found');
    return row;
  }

  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() input: unknown) {
    writable(user);
    const parsed = agentInput.safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid agent configuration');
    const body = parsed.data;
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
    @Body() input: unknown,
  ) {
    writable(user);
    const parsed = agentInput.partial().safeParse(input);
    if (!parsed.success) throw new BadRequestException('Invalid agent configuration');
    const body = parsed.data;
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
    if (!row) throw new NotFoundException('Agent not found');
    return row;
  }

  @Delete(':id')
  async archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    writable(user);
    await withTenantTransaction(this.db, user.organizationId, (tx) =>
      tx.update(agentConfigs)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(and(eq(agentConfigs.organizationId, user.organizationId), eq(agentConfigs.id, id))),
    );
    return { archived: true };
  }
}
