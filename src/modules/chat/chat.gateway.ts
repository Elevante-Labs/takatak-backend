import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
  WsException,
} from '@nestjs/websockets';
import { Logger, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createAdapter } from '@socket.io/redis-adapter';
import { RedisService } from '../../database/redis.service';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto';

interface AuthenticatedSocket extends Socket {
  user: {
    sub: string;
    phone: string;
    role: string;
  };
}

@WebSocketGateway({
  cors: {
    origin: '*', // Restrict in production
    credentials: true,
  },
  namespace: '/chat',
  transports: ['websocket', 'polling'],
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
  ) {}

  afterInit() {
    this.logger.log('WebSocket Gateway initialized');

    // Use @socket.io/redis-adapter for horizontal scaling.
    // This replaces manual psubscribe — the adapter transparently
    // broadcasts all socket.io events across instances via Redis.
    const pubClient = this.redis.getClient();
    const subClient = pubClient.duplicate();

    subClient.on('error', (err) => {
      this.logger.error('Redis adapter sub client error', err.message);
    });

    this.server.adapter(createAdapter(pubClient, subClient) as any);
    this.logger.log('Redis adapter attached for multi-instance scaling');
  }

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token =
        client.handshake?.auth?.token ||
        client.handshake?.headers?.authorization?.split(' ')[1];

      if (!token) {
        this.logger.warn(`Connection rejected: No token provided`);
        client.disconnect();
        return;
      }

      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get<string>('jwt.accessSecret'),
      });

      client.user = payload;

      // Track user's socket connection
      await this.redis.set(`socket:${payload.sub}`, client.id, 3600);

      this.logger.log(`Client connected: ${payload.sub} (${client.id})`);
    } catch (err) {
      this.logger.warn(`Connection rejected: Invalid token - ${(err as Error).message}`);
      client.disconnect();
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    if (client.user) {
      await this.redis.del(`socket:${client.user.sub}`);
      this.logger.log(`Client disconnected: ${client.user.sub} (${client.id})`);
    }
  }

  @SubscribeMessage('joinChat')
  async handleJoinChat(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { chatId: string },
  ) {
    if (!client.user) {
      throw new WsException('Not authenticated');
    }

    const { chatId } = data;

    // Validate user is participant
    try {
      await this.chatService.trackSession(
        client.user.sub,
        chatId,
        client.id,
      );

      client.join(`chat:${chatId}`);

      this.logger.log(`User ${client.user.sub} joined chat ${chatId}`);

      return { event: 'joinedChat', data: { chatId } };
    } catch (err) {
      throw new WsException((err as Error).message);
    }
  }

  @SubscribeMessage('leaveChat')
  async handleLeaveChat(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { chatId: string },
  ) {
    if (!client.user) {
      throw new WsException('Not authenticated');
    }

    const { chatId } = data;

    await this.chatService.removeSession(client.user.sub, chatId);
    client.leave(`chat:${chatId}`);

    this.logger.log(`User ${client.user.sub} left chat ${chatId}`);

    return { event: 'leftChat', data: { chatId } };
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: SendMessageDto,
  ) {
    if (!client.user) {
      throw new WsException('Not authenticated');
    }

    try {
      const result = await this.chatService.sendMessage(
        client.user.sub,
        data.chatId,
        data.content,
      );

      // With @socket.io/redis-adapter, server.to().emit() is
      // automatically broadcast to all instances. No manual
      // Redis publish needed — the adapter handles it.
      this.server
        .to(`chat:${data.chatId}`)
        .emit('newMessage', result.message);

      // Send transaction confirmation to sender
      if (result.transaction) {
        client.emit('paymentConfirmed', {
          transactionId: result.transaction.transactionId,
          coinDeducted: result.transaction.coinAmount,
        });
      }

      return { event: 'messageSent', data: result.message };
    } catch (err) {
      this.logger.error(
        `Message send failed for user ${client.user.sub}: ${(err as Error).message}`,
      );
      throw new WsException((err as Error).message);
    }
  }

  @SubscribeMessage('typing')
  async handleTyping(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { chatId: string },
  ) {
    if (!client.user) return;

    client.to(`chat:${data.chatId}`).emit('userTyping', {
      userId: client.user.sub,
      chatId: data.chatId,
    });
  }

  @SubscribeMessage('stopTyping')
  async handleStopTyping(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { chatId: string },
  ) {
    if (!client.user) return;

    client.to(`chat:${data.chatId}`).emit('userStoppedTyping', {
      userId: client.user.sub,
      chatId: data.chatId,
    });
  }
}
