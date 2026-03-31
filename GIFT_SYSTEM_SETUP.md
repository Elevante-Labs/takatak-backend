# 🚀 Gift System - Quick Setup Guide

## Prerequisites Met ✅

This implementation includes **zero breaking changes**. All existing functionality remains intact.

## 1. Database Setup

Generate and run the migration:

```bash
# From project root
npx prisma migrate dev --name add_gift_system

# This creates:
# - Gift table
# - GiftAnalytics table
# - GiftTransaction table
# - All necessary indexes
```

## 2. Verify Installation

Check that the service starts without errors:

```bash
npm run start:dev

# Look for startup logs:
# ✓ GiftService initialized
# ✓ GiftAdminService initialized
# ✓ GiftAnalyticsService initialized
```

## 3. Create Sample Gifts (Admin Only)

Use the admin API to create gifts:

```bash
# Get admin token first
export ADMIN_TOKEN="your-admin-jwt-token"

# Create a basic gift
curl -X POST http://localhost:3000/admin/gifts \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Rose",
    "iconUrl": "https://example.com/images/rose.png",
    "animationUrl": "https://example.com/animations/rose.mp4",
    "coinCost": 10,
    "diamondValue": 10,
    "category": "BASIC",
    "rarity": "COMMON",
    "displayOrder": 1,
    "isActive": true
  }'

# Create a premium event gift
curl -X POST http://localhost:3000/admin/gifts \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Valentine Heart",
    "iconUrl": "https://example.com/images/valentine-heart.png",
    "animationUrl": "https://example.com/animations/valentine.mp4",
    "animationUrl_full": "https://example.com/animations/valentine-full.mp4",
    "coinCost": 50,
    "diamondValue": 50,
    "category": "EVENT",
    "rarity": "RARE",
    "isLimited": true,
    "availableFrom": "2026-02-01T00:00:00Z",
    "availableTill": "2026-02-14T23:59:59Z",
    "eventTag": "valentine-2026",
    "comboMultiplier": 1.25
  }'
```

## 4. Test User Gift Sending (WebSocket)

### Via Socket.io Client:

```javascript
import io from 'socket.io-client';

// Connect
const socket = io('http://localhost:3000/chat', {
  auth: {
    token: 'user-jwt-token'
  }
});

// Send a gift
socket.emit('sendGift', {
  chatId: 'chat-uuid',
  giftId: 'gift-uuid',
  idempotencyKey: 'uuid-v4-key'
});

// Listen for confirmations
socket.on('messageAck', (data) => {
  console.log('Gift sent:', data);
});

socket.on('paymentConfirmed', (data) => {
  console.log('Payment confirmed:', data);
});

socket.on('giftReceived', (data) => {
  console.log('Gift received with animation:', data.gift.animation);
  // Play animation here
});
```

## 5. Verify API Endpoints

### Get all gifts (public):
```bash
curl http://localhost:3000/gifts \
  -H "Authorization: Bearer $USER_TOKEN"
```

### List admin gifts:
```bash
curl http://localhost:3000/admin/gifts \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### Get analytics:
```bash
curl http://localhost:3000/admin/gifts/analytics/metrics \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

## 6. Database Verification

Check gifts were created:

```bash
# Connect to your PostgreSQL database
psql $DATABASE_URL

# Verify tables exist
\dt gifts
\dt gift_analytics
\dt gift_transactions

# Check sample gift
SELECT * FROM gifts LIMIT 1;
```

## Key URLs & Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/gifts` | JWT | Get all active gifts |
| GET | `/gifts/:id` | JWT | Get single gift |
| WS | `sendGift` | JWT | Send gift (WebSocket) |
| POST | `/admin/gifts` | Admin | Create gift |
| GET | `/admin/gifts` | Admin | List gifts |
| PATCH | `/admin/gifts/:id` | Admin | Update gift |
| DELETE | `/admin/gifts/:id` | Admin | Delete gift |
| GET | `/admin/gifts/analytics/metrics` | Admin | Get metrics |
| GET | `/admin/gifts/analytics/gifters/leaderboard` | Admin | Top gifters |
| GET | `/admin/gifts/analytics/hosts/leaderboard` | Admin | Top earning hosts |

## Configuration

The system works with existing configuration:

```
DATABASE_URL: (existing PostgreSQL)
REDIS_URL: (existing Redis)
JWT_SECRET: (existing)
```

No new environment variables needed!

## Troubleshooting

### 1. Migration fails
```bash
# Reset database (dev only!)
npx prisma migrate reset

# Or manually drop tables:
psql $DATABASE_URL
DROP TABLE IF EXISTS gift_transactions CASCADE;
DROP TABLE IF EXISTS gift_analytics CASCADE;
DROP TABLE IF EXISTS gifts CASCADE;
DROP TYPE IF EXISTS "GiftCategory";
DROP TYPE IF EXISTS "GiftRarity";
```

### 2. Gift catalog empty
Ensure you've created gifts via the admin API (see Section 3)

### 3. WebSocket errors
Check that user is authenticated and passed valid JWT token

### 4. Cache not working
Verify Redis connection:
```bash
redis-cli ping
# Should return: PONG
```

## Performance Tips

1. **Preload gift catalog** on app startup to warm Redis cache
2. **Use CDN URLs** for all gift images and animations
3. **Monitor GiftAnalytics** queries (can run cron job for daily popularity updates)
4. **Archive old GiftTransactions** after 90 days for faster lookups

## Next Steps

1. **Create seed data** with 20-30 common gifts
2. **Upload media** to CDN (icons & animations)
3. **Test load** with concurrent gift sends (1000+ concurrent)
4. **Monitor performance** via application metrics
5. **Plan campaigns** using event-based gift creation

## Documentation

Full API documentation in: [GIFT_SYSTEM_README.md](./GIFT_SYSTEM_README.md)

This includes:
- ✅ Complete schema explanation
- ✅ All endpoint examples
- ✅ Frontend integration guide
- ✅ Monetization strategies
- ✅ Security & optimization details
- ✅ Testing checklist
- ✅ Future roadmap

## Support

All code is production-ready and extensively documented. Key files:

1. `src/modules/gift/gift.service.ts` - Core logic
2. `src/modules/gift/gift-admin.service.ts` - Admin operations
3. `src/modules/gift/gift-analytics.service.ts` - Analytics
4. `prisma/schema.prisma` - Database schema
5. `GIFT_SYSTEM_README.md` - Complete documentation

**You're ready to launch! 🚀**
