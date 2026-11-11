import { Inject, Logger, OnModuleDestroy } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { loadConfig, originAllowed, type AuthService, type EventBus } from '../domain';
import { TOKENS } from '../tokens';

const allowed = loadConfig().corsOrigins;

/**
 * socket.io namespace `/realtime`: forwards domain events (analysis.saved, baseline.trained, …).
 * Accounts disabled: every client gets every event. Accounts enabled: the client must connect with
 * `io(url, { auth: { token } })`; it joins the room `user:<id>` and only receives its own events.
 */
@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: (origin: string | undefined, cb: (err: Error | null, ok?: boolean) => void) => cb(null, originAllowed(origin, allowed)) },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger('Realtime');
  private unsubscribe: (() => void) | null = null;

  constructor(@Inject(TOKENS.EVENTS) private readonly events: EventBus, @Inject(TOKENS.AUTH) private readonly auth: AuthService | null) {}

  afterInit(): void {
    this.unsubscribe = this.events.subscribe((event, payload, ownerId) => {
      if (!this.auth) this.server.emit(event, payload);
      else if (ownerId) this.server.to(`user:${ownerId}`).emit(event, payload);
    });
    this.logger.log(`Namespace /realtime listo (${this.auth ? 'por usuario' : 'público'})`);
  }

  async handleConnection(client: Socket): Promise<void> {
    if (!this.auth) return;
    const token = typeof client.handshake.auth?.token === 'string' ? client.handshake.auth.token : undefined;
    const user = await this.auth.authenticate(token);
    if (!user) {
      client.emit('auth.error', { code: 'AUTH_REQUIRED', message: 'Inicia sesión para recibir avisos en tiempo real.' });
      client.disconnect(true);
      return;
    }
    await client.join(`user:${user.id}`);
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }
}
