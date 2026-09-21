import { Controller, Body, Headers, UnauthorizedException, Inject, Post, Get, Delete, Param, ParseUUIDPipe, UseGuards, ForbiddenException, NotFoundException, ServiceUnavailableException, ConflictException, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq, desc, sql, inArray } from 'drizzle-orm';
import { AccessToken, RoomServiceClient, AgentDispatchClient, TrackSource } from 'livekit-server-sdk';
import { agentConfigs, voiceTestSessions, withTenantTransaction, type Database } from '@india-voice/database';
import { ClerkAuthGuard } from '../auth/clerk.guard';
import { CurrentUser, type AuthenticatedUser } from '../auth/current-user.decorator';
import { DATABASE } from '../database.token';
import { APP_CONFIG } from '../config.token';
import type { AppConfig } from '../config';
import { agentInput } from '../agents/agents.controller';

type Session = typeof voiceTestSessions.$inferSelect;
@Controller('voice-tests')
@UseGuards(ClerkAuthGuard)
export class VoiceController implements OnApplicationShutdown, OnModuleInit {
  private rooms?: RoomServiceClient;
  private dispatch?: AgentDispatchClient;
  private timers = new Map<string, NodeJS.Timeout>();
  private owned = new Map<string, Session>();
  private stopping = false;
  private recoveryTimer?: NodeJS.Timeout;
  private recovering = false;
  private schedule(row: Session) {
    this.owned.set(row.id, row);
    const timer = setTimeout(() => { this.cleanup(row); void this.update(row, { status: 'expired', endedAt: new Date() }).catch(() => undefined); }, Math.max(1, row.expiresAt.getTime() - Date.now()));
    timer.unref(); this.timers.set(row.id, timer);
  }
  async onModuleInit() {
    if (this.config.VOICE_TEST_ENABLED === 'true') {
      this.recoveryTimer = setInterval(() => { void this.recoverRooms(); }, 30000);
      this.recoveryTimer.unref();
    }
    await this.recoverRooms();
  }
  private async recoverRooms() {
    if (this.stopping || this.recovering) return;
    if (!this.rooms || this.config.VOICE_TEST_ENABLED !== 'true') return;
    this.recovering = true;
    try {
      // Recover only dashboard rooms, and verify their ownership against RLS-backed
      // records before acting. Room metadata is written by the trusted server.
      const rooms = await this.rooms.listRooms();
      for (const room of rooms) {
        if (!/^iv-dashboard-[0-9a-f-]{36}$/.test(room.name)) continue;
        let metadata: { id: string; organizationId: string };
        try { metadata = z.object({ id: z.string().uuid(), organizationId: z.string().uuid() }).parse(JSON.parse(room.metadata)); } catch { continue; }
        const [row] = await withTenantTransaction(this.db, metadata.organizationId, tx => tx.select().from(voiceTestSessions).where(eq(voiceTestSessions.id, metadata.id)).limit(1));
        if (!row || row.room !== room.name || this.owned.has(row.id)) continue;
        if (['starting','active'].includes(row.status)) this.schedule(row); else this.cleanup(row);
      }
    } catch { console.warn('Voice session recovery deferred: LiveKit or database unavailable'); }
    finally { this.recovering = false; }
  }
  constructor(@Inject(DATABASE) private db: Database, @Inject(APP_CONFIG) private config: AppConfig) {
    if (config.LIVEKIT_URL && config.LIVEKIT_API_KEY && config.LIVEKIT_API_SECRET) {
      const host = config.LIVEKIT_URL.replace(/^ws/, 'http');
      this.rooms = new RoomServiceClient(host, config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, { requestTimeout: 8 });
      this.dispatch = new AgentDispatchClient(host, config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, { requestTimeout: 8 });
    }
  }
  private async find(user: AuthenticatedUser, id: string) {
    const [row] = await withTenantTransaction(this.db, user.organizationId, tx => tx.select().from(voiceTestSessions).where(eq(voiceTestSessions.id, id)).limit(1));
    if (!row) throw new NotFoundException('Voice session not found');
    return row;
  }
  private async update(row: Session, values: Partial<typeof voiceTestSessions.$inferInsert>) {
    await withTenantTransaction(this.db, row.organizationId, tx => tx.update(voiceTestSessions).set({ ...values, updatedAt: new Date() }).where(and(eq(voiceTestSessions.id, row.id), inArray(voiceTestSessions.status, ['starting','active']))));
  }
  // Retry deletion through the join-token lifetime: an ended room must not resume
  // if the same short-lived token reconnects. Never accept a room name from clients.
  private cleanup(row: Session) {
    this.owned.set(row.id, row);
    const previous = this.timers.get(row.id); if (previous) clearInterval(previous);
    const until = Math.max(Date.now() + 130000, row.createdAt.getTime() + 130000);
    const attempt = async () => {
      try { await this.rooms?.deleteRoom(row.room); } catch { /* retry below; empty room timeout is additional protection */ }
      if (Date.now() >= until) { const timer = this.timers.get(row.id); if (timer) clearInterval(timer); this.timers.delete(row.id); this.owned.delete(row.id); }
    };
    const timer = setInterval(() => { void attempt(); }, 5000); timer.unref();
    this.timers.set(row.id, timer); void attempt();
  }
  @Post(':agentId')
  async start(@CurrentUser() user: AuthenticatedUser, @Param('agentId', ParseUUIDPipe) agentId: string) {
    if (this.stopping) throw new ServiceUnavailableException('API is stopping');
    if (user.role === 'viewer') throw new ForbiddenException('Viewers cannot start voice tests');
    if (this.config.VOICE_TEST_ENABLED !== 'true' || !this.rooms || !this.dispatch) throw new ServiceUnavailableException('Browser voice testing is disabled or LiveKit is not configured');
    const row = await withTenantTransaction(this.db, user.organizationId, async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${user.organizationId}))`);
      const [agent] = await tx.select().from(agentConfigs).where(and(eq(agentConfigs.id, agentId), eq(agentConfigs.status, 'active'))).limit(1);
      if (!agent) throw new NotFoundException('Active agent not found');
      const active = await tx.select({ id: voiceTestSessions.id }).from(voiceTestSessions).where(and(inArray(voiceTestSessions.status, ['starting', 'active']), sql`${voiceTestSessions.expiresAt} > now()`));
      if (active.length >= 2) throw new ConflictException('Two voice tests are already running; end one first');
      const parsed = agentInput.safeParse({ name: agent.name, description: agent.description, language: agent.language, voice: agent.voice ?? 'shubh', instructions: agent.instructions, openingMessage: agent.openingMessage });
      if (!parsed.success) throw new ConflictException('Edit and save this agent before testing: its configuration is invalid');
      const id = randomUUID();
      const [created] = await tx.insert(voiceTestSessions).values({ id, organizationId: user.organizationId, userId: user.userId, agentId, room: 'iv-dashboard-' + id, snapshot: parsed.data, expiresAt: new Date(Date.now() + 600000) }).returning();
      return created!;
    });
    try {
      this.owned.set(row.id, row);
      await this.rooms.createRoom({ name: row.room, emptyTimeout: 30, departureTimeout: 10, maxParticipants: 2, metadata: JSON.stringify({ id: row.id, organizationId: row.organizationId }) });
      if (this.stopping) throw new Error('stopping');
      await this.dispatch.createDispatch(row.room, this.config.VOICE_AGENT_NAME, { metadata: JSON.stringify({ dashboard: true, session_id: row.id, organization_id: row.organizationId, expires_at: row.expiresAt.toISOString(), agent: row.snapshot }) });
      const token = new AccessToken(this.config.LIVEKIT_API_KEY, this.config.LIVEKIT_API_SECRET, { identity: 'tester-' + row.id, ttl: 120 });
      token.addGrant({ roomJoin: true, room: row.room, canPublish: true, canPublishSources: [TrackSource.MICROPHONE], canSubscribe: true, canPublishData: false, canUpdateOwnMetadata: false });
      // Independent server timeout, recovered from trusted room metadata on restart.
      if (this.stopping) throw new Error('stopping');
      this.schedule(row);
      return { id: row.id, url: this.config.LIVEKIT_URL, token: await token.toJwt(), expiresAt: row.expiresAt, agentName: row.snapshot.name };
    } catch {
      this.cleanup(row);
      await this.update(row, { status: 'failed', errorCode: 'dispatch_failed', endedAt: new Date() });
      throw new ServiceUnavailableException('Could not start LiveKit. Check the server and voice worker.');
    }
  }
  @Get('agent/:agentId')
  async history(@CurrentUser() user: AuthenticatedUser, @Param('agentId', ParseUUIDPipe) agentId: string) {
    return withTenantTransaction(this.db, user.organizationId, tx => tx.select({ id: voiceTestSessions.id, status: voiceTestSessions.status, errorCode: voiceTestSessions.errorCode, createdAt: voiceTestSessions.createdAt, expiresAt: voiceTestSessions.expiresAt }).from(voiceTestSessions).where(eq(voiceTestSessions.agentId, agentId)).orderBy(desc(voiceTestSessions.createdAt)).limit(20));
  }
  @Get(':id')
  async status(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    const row = await this.find(user, id);
    if (!['starting','active'].includes(row.status)) { this.cleanup(row); return { status: row.status, errorCode: row.errorCode }; }
    if (row.expiresAt.getTime() <= Date.now()) { this.cleanup(row); await this.update(row, { status: 'expired', endedAt: new Date() }); return { status: 'expired' }; }
    try {
      const participants = await this.rooms!.listParticipants(row.room);
      const agent = participants.find(p => p.attributes['iv.session'] === row.id);
      const ready = agent?.attributes['iv.ready'] === 'true';
      const error = agent?.attributes['iv.error'];
      if (error) { await this.update(row, { status: 'failed', errorCode: 'provider_error', endedAt: new Date() }); this.cleanup(row); return { status: 'failed', errorCode: 'provider_error' }; }
      if (!ready && Date.now() - row.createdAt.getTime() > 45000) { await this.update(row, { status: 'failed', errorCode: 'worker_unavailable', endedAt: new Date() }); this.cleanup(row); return { status: 'failed', errorCode: 'worker_unavailable' }; }
      if (ready && row.status !== 'active') await this.update(row, { status: 'active' });
      return { status: ready ? 'active' : 'starting' };
    } catch { throw new ServiceUnavailableException('Cannot reach LiveKit; reconnecting may be necessary'); }
  }
  @Delete(':id')
  async end(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    const row = await this.find(user, id);
    if (row.userId !== user.userId && !['owner','admin'].includes(user.role)) throw new ForbiddenException('Only the session owner or an administrator can end this test');
    this.cleanup(row);
    if (['starting','active'].includes(row.status)) await this.update(row, { status: 'ended', endedAt: new Date() });
    return { cleanup: 'scheduled' };
  }
  async onApplicationShutdown() {
    this.stopping = true;
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    await Promise.allSettled([...this.owned.values()].map(async row => {
      await this.rooms?.deleteRoom(row.room);
      await this.update(row, { status: 'ended', endedAt: new Date() });
    }));
    this.owned.clear();
  }
}

// Worker-only lifecycle callbacks. Body is bounded and signed; browser JWTs do
// not authorize this endpoint and provider secrets are never sent to browsers.
@Controller('internal/voice-tests')
export class VoiceEventsController {
  constructor(@Inject(DATABASE) private db: Database, @Inject(APP_CONFIG) private config: AppConfig) {}
  @Post('event')
  async event(@Body() body: unknown, @Headers('x-voice-timestamp') timestamp: string, @Headers('x-voice-signature') signature: string) {
    const epoch = Number(timestamp);
    if (!this.config.LIVEKIT_API_SECRET || !Number.isFinite(epoch) || Math.abs(Date.now()/1000 - epoch) > 60 || !/^[a-f0-9]{64}$/.test(signature ?? '')) throw new UnauthorizedException();
    const expected = createHmac('sha256', this.config.LIVEKIT_API_SECRET).update(timestamp + '\n' + JSON.stringify(body)).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw new UnauthorizedException();
    const parsed = z.object({ id: z.string().uuid(), organizationId: z.string().uuid(), status: z.enum(['active','ended','failed','expired']), errorCode: z.enum(['provider_error','startup_failed']).nullable() }).strict().safeParse(body);
    if (!parsed.success) throw new UnauthorizedException();
    const event = parsed.data;
    await withTenantTransaction(this.db, event.organizationId, tx => tx.update(voiceTestSessions).set({ status: event.status, errorCode: event.errorCode, updatedAt: new Date(), ...(event.status === 'active' ? {} : { endedAt: new Date() }) }).where(and(eq(voiceTestSessions.id, event.id), inArray(voiceTestSessions.status, ['starting','active']))));
    return { accepted: true };
  }
}
