import {
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { RedisService } from '../../database/redis.service';

/**
 * Intimacy WebSocket Gateway.
 * Shares the /chat namespace to avoid requiring a separate socket connection.
 * Emits real-time events for intimacy updates, level-ups, and relationship changes.
 */
@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: '/chat',
  transports: ['websocket', 'polling'],
})
export class IntimacyGateway {
  private readonly logger = new Logger(IntimacyGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly redis: RedisService) {}

  /**
   * Emit intimacy_updated event to both users.
   */
  async emitIntimacyUpdated(
    userAId: string,
    userBId: string,
    data: {
      level: number;
      score: number;
      xpEarned: number;
      progressPercent: number;
    },
  ) {
    await Promise.all([
      this.emitToUser(userAId, 'intimacy_updated', {
        otherUserId: userBId,
        ...data,
      }),
      this.emitToUser(userBId, 'intimacy_updated', {
        otherUserId: userAId,
        ...data,
      }),
    ]);
  }

  /**
   * Emit level_up event to both users.
   */
  async emitLevelUp(
    userAId: string,
    userBId: string,
    data: {
      previousLevel: number;
      newLevel: number;
      score: number;
    },
  ) {
    await Promise.all([
      this.emitToUser(userAId, 'level_up', {
        otherUserId: userBId,
        ...data,
      }),
      this.emitToUser(userBId, 'level_up', {
        otherUserId: userAId,
        ...data,
      }),
    ]);
  }

  /**
   * Emit relationship_status_change event to both users.
   */
  async emitRelationshipChange(
    userAId: string,
    userBId: string,
    data: {
      status: string;
      type: string;
      relationshipId: string;
    },
  ) {
    await Promise.all([
      this.emitToUser(userAId, 'relationship_status_change', {
        otherUserId: userBId,
        ...data,
      }),
      this.emitToUser(userBId, 'relationship_status_change', {
        otherUserId: userAId,
        ...data,
      }),
    ]);
  }

  /**
   * Emit event to a specific user via their socket ID stored in Redis.
   */
  private async emitToUser(userId: string, event: string, data: any) {
    const socketId = await this.redis.get(`socket:${userId}`);
    if (socketId) {
      this.server.to(socketId).emit(event, data);
    }
  }
}
