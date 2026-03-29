# Takatak Backend

Production-grade, scalable backend for **Takatak** — a monetized private 1:1 chat platform with verified host promotion, diamond conversion, and withdrawal support.

Built with NestJS, PostgreSQL, Prisma, Redis, Socket.io (`@socket.io/redis-adapter`), and JWT authentication.

> **Phase 1 scope**: Private 1:1 chat earning system. Audio rooms, agency hierarchy, leaderboard engine, PK battles, milestone competitions, and salary logic are excluded.

---

## Architecture

```
src/
├── common/               # Shared guards, filters, interceptors, decorators, DTOs
│   ├── decorators/       # @Roles(), @CurrentUser()
│   ├── dto/              # PaginationDto
│   ├── filters/          # GlobalExceptionFilter
│   ├── guards/           # RolesGuard, WsJwtGuard
│   ├── interceptors/     # TransformInterceptor, LoggingInterceptor
│   └── utils/            # Pagination helpers
├── config/               # Configuration & env validation
├── database/             # PrismaService, RedisService, DatabaseModule
├── modules/
│   ├── auth/             # OTP-based auth, JWT access+refresh tokens
│   ├── users/            # User CRUD, admin management, verified host promotion
│   ├── wallet/           # Atomic coin/diamond transactions, recharge, conversion
│   ├── chat/             # Real-time monetized 1:1 chat (REST + WebSocket)
│   ├── referral/         # Registration & first-chat referral rewards
│   ├── vip/              # VIP tiers, discounts, benefits
│   ├── fraud/            # Rate limiting, self-chat detection, multi-account flagging
│   ├── follow/           # Follow / unfollow system (mutual follow enables free chat)
│   ├── withdrawal/       # Diamond withdrawal requests + admin approval flow
│   ├── host/             # Host dashboard (earnings, stats, conversion)
│   ├── admin/            # System settings management (DIAMOND_TO_COIN_RATIO, etc.)
│   └── health/           # Health check endpoints
├── app.module.ts         # Root module
└── main.ts               # Bootstrap with middleware stack
```

### Key Design Decisions

- **Atomic wallet operations**: All coin/diamond mutations use Prisma raw SQL `SELECT … FOR UPDATE` inside serializable transactions to prevent race conditions and double-spend.
- **Idempotency**: Recharge, chat payment, and conversion endpoints accept an optional `x-idempotency-key` header. When provided, duplicate requests return the original result instead of re-processing. Enforced via `@unique` constraint on `Transaction.idempotencyKey` in the database. The key is **optional** (not rejected if missing) — clients should always send one for financial operations.
- **Coin priority system**: Game coins are consumed before gift coins during chat payments.
- **Role-based chat pricing**: Users pay coins per message; Hosts reply free. If a **user and host mutually follow each other** (both `follow.followerId→followeeId` rows exist), messages are free — this is a promotional incentive encouraging reciprocal engagement. One-way follow alone is NOT enough.
- **Verified host promotion**: Online host list is ranked by a composite score `(diamondsEarned × 0.5) + (totalMessages × 0.2) + (recentActivity × 0.3)`, multiplied by `VERIFIED_BOOST_MULTIPLIER` for verified hosts. Score is computed dynamically per request (N+1 queries per host). **Scaling note**: for large host counts, precompute scores into a materialized view or cache.
- **Diamond economy**: Hosts earn diamonds from chat → convert diamonds to coins (admin-configurable ratio) → request withdrawal. **Diamonds are deducted immediately** on withdrawal request creation (locked). If admin rejects → diamonds are refunded atomically.
- **Admin-configurable settings**: `DIAMOND_TO_COIN_RATIO`, `MESSAGE_MAX_LENGTH`, `VERIFIED_BOOST_MULTIPLIER`, `MIN_WITHDRAWAL_DIAMONDS` stored in `SystemSettings` table.
- **Horizontal scaling**: `@socket.io/redis-adapter` (`createAdapter`) attached in `afterInit()`. No manual `publish`/`psubscribe` — the adapter transparently broadcasts `server.to(room).emit()` across all instances. No in-memory state.
- **Fraud pipeline**: Atomic Redis `INCR`-based rate limiter + device fingerprint self-chat detection + multi-account flagging — flags without auto-banning.
- **JWT rotation**: Refresh tokens are blacklisted in Redis on use, preventing replay attacks.

---

## Tech Stack

| Layer            | Technology                          |
|------------------|-------------------------------------|
| Framework        | NestJS (Express)                    |
| Language         | TypeScript (strict mode)            |
| Database         | PostgreSQL (Neon-ready)             |
| ORM              | Prisma 6.x                         |
| Cache / PubSub   | Redis (ioredis)                    |
| WebSocket        | Socket.io + @socket.io/redis-adapter |
| Auth             | JWT + Passport                     |
| Validation       | class-validator                    |
| Rate Limiting    | @nestjs/throttler                  |
| Scheduler        | @nestjs/schedule                   |
| Containerization | Docker, Docker Compose             |

---

## Prerequisites

- **Node.js** >= 18
- **npm** >= 9
- **PostgreSQL** >= 14
- **Redis** >= 7
- **Docker** & **Docker Compose** (optional)

---

## Quick Start

### 1. Clone & Install

```bash
cd Takatak-Backend
npm install
```

### 2. Environment Setup

```bash
cp .env.example .env
# Edit .env with your database URL, Redis host, JWT secrets, etc.
```

### 3. Start Infrastructure (Docker)

```bash
# Dev: only Postgres + Redis (run app locally)
docker compose -f docker-compose.dev.yml up -d

# OR full stack including app
docker compose up -d
```

### 4. Database Migration

```bash
# Generate migration from schema
npx prisma migrate dev --name init

# Apply Phase 1 manual migration (CHECK constraints + seed settings)
psql "$DATABASE_URL" -f prisma/migrations/manual/001_add_check_constraints_and_indexes.sql
psql "$DATABASE_URL" -f prisma/migrations/manual/002_phase1_follow_withdrawal_settings.sql

# Generate Prisma client
npx prisma generate
```

### 5. Run Application

```bash
# Development (hot reload)
npm run dev

# Production
npm run build && npm run start:prod
```

The API is available at `http://localhost:3000/api/v1/`.
Health check: `http://localhost:3000/health`

---

## API Endpoints

### Auth

| Method | Endpoint                   | Description            |
|--------|----------------------------|------------------------|
| POST   | `/api/v1/auth/otp/request` | Request OTP            |
| POST   | `/api/v1/auth/otp/verify`  | Verify OTP → tokens    |
| POST   | `/api/v1/auth/refresh`     | Refresh access token   |
| POST   | `/api/v1/auth/logout`      | Logout (blacklist)     |

### Users

| Method | Endpoint                     | Description                                  |
|--------|------------------------------|----------------------------------------------|
| GET    | `/api/v1/users/me`           | Get current user                             |
| PATCH  | `/api/v1/users/me`           | Update profile                               |
| GET    | `/api/v1/users/hosts/online` | List online hosts (ranked by promotion score) |
| GET    | `/api/v1/users/admin/list`   | Admin: list users                            |

### Wallet

| Method | Endpoint                                | Description                       |
|--------|-----------------------------------------|-----------------------------------|
| GET    | `/api/v1/wallet/balance`                | Get wallet balance                |
| POST   | `/api/v1/wallet/recharge`               | Recharge coins (admin)            |
| POST   | `/api/v1/wallet/convert/coins-to-diamonds` | Convert coins → diamonds       |
| POST   | `/api/v1/wallet/convert/diamonds-to-coins` | Convert diamonds → coins (configurable ratio) |
| POST   | `/api/v1/wallet/daily-bonus`            | Claim daily bonus                 |
| GET    | `/api/v1/wallet/transactions`           | Transaction history (paginated)   |

### Chat

| Method | Endpoint                         | Description                      |
|--------|----------------------------------|----------------------------------|
| POST   | `/api/v1/chat`                   | Create / get 1:1 chat            |
| GET    | `/api/v1/chat`                   | List user's chats (paginated)    |
| GET    | `/api/v1/chat/:chatId/messages`  | Get chat messages (paginated)    |

### WebSocket (Socket.io)

Connect to namespace `/chat` with JWT in handshake:

```typescript
const socket = io('http://localhost:3000/chat', {
  auth: { token: 'Bearer <access_token>' }
});

// Events
socket.emit('joinChat', { chatId: '...' });
socket.emit('sendMessage', { chatId: '...', content: '...', idempotencyKey: '<unique-key>' });
// server will respond with 'messageAck' (or 'messageError' on failure)
socket.emit('typing', { chatId: '...' });
socket.on('newMessage', (message) => { /* ... */ });
socket.on('userTyping', (data) => { /* ... */ });
```

### Follow

| Method | Endpoint                            | Description                 |
|--------|-------------------------------------|-----------------------------|
| POST   | `/api/v1/users/:id/follow`          | Follow a user               |
| DELETE | `/api/v1/users/:id/follow`          | Unfollow a user             |
| GET    | `/api/v1/users/:id/followers`       | List followers (paginated)  |
| GET    | `/api/v1/users/:id/following`       | List following (paginated)  |
| GET    | `/api/v1/users/:id/follow/status`   | Check follow status         |

### Withdrawal (Host)

| Method | Endpoint                              | Description                          |
|--------|---------------------------------------|--------------------------------------|
| POST   | `/api/v1/wallet/withdrawals`          | Create withdrawal request (HOST only)|
| GET    | `/api/v1/wallet/withdrawals/mine`     | My withdrawal requests (paginated)   |

### Host Dashboard

| Method | Endpoint                  | Description                                     |
|--------|---------------------------|-------------------------------------------------|
| GET    | `/api/v1/host/dashboard`  | Earnings, balance, stats, conversion ratio       |

### Referral

| Method | Endpoint                    | Description          |
|--------|-----------------------------|----------------------|
| POST   | `/api/v1/referral/apply`    | Apply referral code  |
| GET    | `/api/v1/referral/stats`    | Referral statistics  |
| GET    | `/api/v1/referral/history`  | Referral history     |

### VIP

| Method | Endpoint               | Description      |
|--------|------------------------|------------------|
| GET    | `/api/v1/vip/status`   | Get VIP status   |
| POST   | `/api/v1/vip/upgrade`  | Upgrade VIP level|
| GET    | `/api/v1/vip/benefits` | VIP benefits info|

### Fraud (Admin)

| Method | Endpoint                            | Description         |
|--------|-------------------------------------|---------------------|
| GET    | `/api/v1/fraud/flags`               | List fraud flags    |
| POST   | `/api/v1/fraud/flags/:id/resolve`   | Resolve a flag      |
| GET    | `/api/v1/fraud/users/:id/summary`   | User fraud summary  |

### Admin — Withdrawals

| Method | Endpoint                                  | Description                        |
|--------|-------------------------------------------|------------------------------------|
| GET    | `/api/v1/admin/withdrawals`               | List all withdrawal requests       |
| PUT    | `/api/v1/admin/withdrawals/:id/approve`   | Approve a withdrawal               |
| PUT    | `/api/v1/admin/withdrawals/:id/reject`    | Reject a withdrawal (refunds diamonds) |

### Admin — System Settings

| Method | Endpoint                        | Description                  |
|--------|---------------------------------|------------------------------|
| GET    | `/api/v1/admin/settings`        | List all system settings     |
| GET    | `/api/v1/admin/settings/:key`   | Get a single setting         |
| PUT    | `/api/v1/admin/settings/:key`   | Update a setting             |

Configurable keys: `DIAMOND_TO_COIN_RATIO`, `MESSAGE_MAX_LENGTH`, `VERIFIED_BOOST_MULTIPLIER`, `MIN_WITHDRAWAL_DIAMONDS`

### Health

| Method | Endpoint        | Description             |
|--------|-----------------|-------------------------|
| GET    | `/health`       | DB + Redis health check |
| GET    | `/health/ping`  | Simple pong             |

---

## Environment Variables

| Variable                       | Default       | Description                             |
|--------------------------------|---------------|-----------------------------------------|
| `PORT`                         | `3000`        | Application port                        |
| `NODE_ENV`                     | `development` | Environment                             |
| `DATABASE_URL`                 | —             | PostgreSQL connection string (required)  |
| `REDIS_HOST`                   | `localhost`   | Redis host                              |
| `REDIS_PORT`                   | `6379`        | Redis port                              |
| `JWT_ACCESS_SECRET`            | —             | JWT access token secret (required)       |
| `JWT_REFRESH_SECRET`           | —             | JWT refresh token secret (required)      |
| `JWT_ACCESS_EXPIRES_IN`        | `15m`         | Access token expiry                      |
| `JWT_REFRESH_EXPIRES_IN`       | `7d`          | Refresh token expiry                     |
| `WALLET_SIGNUP_GIFT_COINS`     | `100`         | Welcome bonus gift coins                 |
| `WALLET_MESSAGE_COIN_COST`     | `10`          | Cost per message in coins                |
| `WALLET_COIN_TO_DIAMOND_RATIO` | `1`           | Coin-to-diamond conversion ratio         |
| `REFERRAL_REFERRER_BONUS`      | `50`          | Bonus for referrer                       |
| `REFERRAL_REFEREE_BONUS`       | `25`          | Bonus for referee                        |
| `FRAUD_MESSAGE_RATE_LIMIT`     | `30`          | Max messages per window                  |
| `FRAUD_MESSAGE_RATE_WINDOW`    | `60`          | Rate window in seconds                   |
| `CORS_ORIGIN`                  | `*`           | Allowed CORS origins                     |

Additional settings are admin-configurable at runtime via the `SystemSettings` table (see Admin — System Settings).

See [.env.example](.env.example) for the full list.

---

## Scripts

```bash
npm run dev              # Start with hot reload (ts-node)
npm run build            # Compile TypeScript
npm run start:prod       # Run compiled JS
npm run lint             # ESLint
npm run format           # Prettier
npm test                 # Run unit tests (9 suites, 87 tests)
npm run test:watch       # Tests in watch mode
npm run test:cov         # Tests with coverage
npm run test:e2e         # End-to-end tests
npm run prisma:generate  # Generate Prisma client
npm run prisma:migrate   # Run migrations
npm run prisma:studio    # Open Prisma Studio
npm run docker:up        # docker compose up -d
npm run docker:down      # docker compose down
npm run docker:dev       # docker compose -f docker-compose.dev.yml up -d
```

---

## Docker

### Full Stack (App + Postgres + Redis)

```bash
docker compose up -d

# Run migrations inside container
docker compose exec app npx prisma migrate deploy
```

### Development (Postgres + Redis only)

```bash
docker compose -f docker-compose.dev.yml up -d
npm run dev
```

---

## Database Schema

15 models across 5 enums:

**Enums**: `Role` (USER / HOST / ADMIN), `TransactionType` (RECHARGE, CHAT_PAYMENT, REFERRAL_REWARD, DAILY_BONUS, COIN_TO_DIAMOND, DIAMOND_TO_COIN, WITHDRAWAL), `WithdrawalStatus` (PENDING / APPROVED / REJECTED), `TransactionStatus` (SUCCESS / FAILED / REVERSED), `FraudFlagType`

**Models**:

| Model               | Purpose                                                            |
|---------------------|--------------------------------------------------------------------|
| **User**            | Phone auth, roles (USER/HOST/ADMIN), VIP level, verified flag, soft delete |
| **Otp**             | OTP codes with attempt tracking and expiry                         |
| **Wallet**          | `giftCoins`, `gameCoins`, `diamonds`, `promoDiamonds`              |
| **Transaction**     | Immutable ledger — `coinAmount`, `diamondAmount`, `idempotencyKey` |
| **Chat**            | 1:1 chat between `user1` and `user2` (unique pair)                |
| **Message**         | Per-chat messages with `coinCost` and `diamondGenerated` tracking  |
| **ChatSession**     | Active WebSocket sessions (online status)                          |
| **Referral**        | Referrer → referred with bonus flags                               |
| **FraudFlag**       | Flagged suspicious activity for admin review                       |
| **Follow**          | Follower ↔ followee (unique pair, mutual follow enables free chat) |
| **WithdrawalRequest** | Host diamond withdrawals with admin approval workflow            |
| **SystemSettings**  | Admin-configurable key/value pairs                                 |

Database-level CHECK constraints enforce non-negative balances and positive transaction amounts. See the manual migration files for details.

---

## Business Logic — Phase 1 Chat Earning Flow

```
User sends message
  → Content sanitized (XSS strip + max length from SystemSettings)
  → Device fingerprint self-chat check
  → Rate limit check (atomic Redis INCR + EXPIRE via Lua script)
  → Role-based charging:
      • HOST → anyone: FREE (no coins, no diamonds)
      • USER ↔ HOST mutual follow: FREE (promotional incentive, one-way not enough)
      • USER → HOST: deduct coins (game coins first, then gift coins), HOST earns diamonds
      • USER → USER: deduct coins, no diamonds generated
  → Wallet transaction (idempotent, SELECT FOR UPDATE)
  → Message persisted + broadcast via Socket.io (Redis adapter)
```

> **Mutual-follow-free**: `isMutualFollow(sender.id, receiver.id)` checks both follow directions with a single indexed `COUNT` query (`WHERE OR [{A→B}, {B→A}]`, count === 2). Both the user and host must follow each other for free chat. One-way follow is charged normally.

**Host earns → converts → withdraws**:
1. Host accumulates diamonds from received chat messages
2. Host converts diamonds to coins (`DIAMOND_TO_COIN_RATIO` from SystemSettings)
3. Host submits withdrawal request (minimum `MIN_WITHDRAWAL_DIAMONDS`)
4. **Diamonds deducted immediately** on request creation (locked funds)
5. Admin approves → withdrawal complete | Admin rejects → diamonds refunded atomically

---

## Testing

```bash
# Unit tests
npm test

# With coverage
npm run test:cov

# Watch mode
npm run test:watch
```

**9 test suites, 87 tests** covering:

| Suite                       | Coverage                                                          |
|-----------------------------|-------------------------------------------------------------------|
| **WalletService**           | Atomic transactions, idempotency, insufficient balance, coin priority, conversion |
| **ChatService**             | Monetized messaging, rate limiting, self-chat detection, host free reply, mutual-follow-free, content sanitization |
| **AuthService**             | OTP request/verify, rate limiting, token generation, refresh rotation, blacklisting |
| **FraudService**            | Atomic rate limiter, device fingerprint checks, multi-account detection |
| **ReferralService**         | Self-referral prevention, duplicate detection, circular chain (depth-10), device abuse |
| **WithdrawalService**       | Request creation, approval/rejection, refund, min-diamond guard   |
| **FollowService**           | Follow/unfollow, follower/following lists, duplicate prevention    |
| **HostDashboardService**    | Earnings aggregation, balance, conversion ratio, follower count   |
| **AdminSettingsService**    | CRUD, key whitelist, positive-number validation                   |

---

## License

Proprietary — Elevante Labs
