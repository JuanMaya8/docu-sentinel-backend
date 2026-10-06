import { Inject, Logger } from '@nestjs/common';
import { OnGatewayInit, OnModuleDestroy, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server } from 'socket.io';
import { loadConfig, type EventBus } from '../domain';
import { TOKENS } from '../tokens';

/** socket.io namespace `/realtime`: forwards domain events (analysis.saved, baseline.trained, …) to every connected client. */
@WebSocketGateway({ namespace: '/realtime', cors: { origin: loadConfig().corsOrigins } })
export class RealtimeGateway implements OnGatewayInit, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger('Realtime');
  private unsubscribe: (() => void) | null = null;

  constructor(@Inject(TOKENS.EVENTS) private readonly events: EventBus) {}

  afterInit(): void {
    this.unsubscribe = this.events.subscribe((event, payload) => {
      this.server.emit(event, payload);
    });
    this.logger.log('Namespace /realtime listo');
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }
}
