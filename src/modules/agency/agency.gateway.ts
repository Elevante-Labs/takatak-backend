import {
    WebSocketGateway,
    WebSocketServer,
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../database/redis.service';

interface AuthenticatedSocket extends Socket {
    user: {
        sub: string;
        phone: string;
        role: string;
    };
}

@WebSocketGateway({
    cors: {
        origin: '*',
        credentials: true,
    },
    namespace: '/agency',
    transports: ['websocket', 'polling'],
})
export class AgencyGateway
    implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    private readonly logger = new Logger(AgencyGateway.name);

    @WebSocketServer()
    server!: Server;

    constructor(
        private readonly jwtService: JwtService,
        private readonly configService: ConfigService,
        private readonly redis: RedisService,
    ) { }

    afterInit() {
        this.logger.log('Agency WebSocket Gateway initialized on /agency namespace');
    }

    async handleConnection(client: AuthenticatedSocket) {
        try {
            let token =
                client.handshake?.auth?.token ||
                client.handshake?.headers?.authorization;

            if (token?.startsWith('Bearer ')) {
                token = token.split(' ')[1];
            }

            if (!token) {
                this.logger.warn('Agency WS connection rejected: No token');
                client.disconnect();
                return;
            }

            const payload = await this.jwtService.verifyAsync(token, {
                secret: this.configService.get<string>('jwt.accessSecret'),
            });

            client.user = payload;

            // Track user's agency socket connection
            await this.redis.set(`agency-socket:${payload.sub}`, client.id, 3600);

            // Join a room for the user so we can emit to them by userId
            client.join(`agency-user:${payload.sub}`);

            this.logger.log(
                `Agency WS connected: ${payload.sub} (${client.id})`,
            );
        } catch (err) {
            this.logger.warn(
                `Agency WS connection rejected: ${(err as Error).message}`,
            );
            client.disconnect();
        }
    }

    async handleDisconnect(client: AuthenticatedSocket) {
        if (client.user) {
            await this.redis.del(`agency-socket:${client.user.sub}`);
            this.logger.log(
                `Agency WS disconnected: ${client.user.sub} (${client.id})`,
            );
        }
    }

    // ──────────────────────────────────────────
    // Event Emission Methods (called by AgencyService)
    // ──────────────────────────────────────────

    /**
     * Emit an event to a specific user by their userId.
     * The user must be connected to the /agency namespace.
     */
    emitToUser(userId: string, event: string, data: any) {
        this.server.to(`agency-user:${userId}`).emit(event, data);
        this.logger.debug(`Emitted ${event} to user ${userId}`);
    }

    /**
     * Broadcast an event to all connected agency users.
     */
    broadcast(event: string, data: any) {
        this.server.emit(event, data);
    }
}
