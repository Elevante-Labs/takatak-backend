# 🧪 Testing the Wallet Fix

**Quick Reference Checklist**

---

## Pre-Test Setup

- [ ] Database is reset: `npx prisma migrate reset --force`
- [ ] Dev server running: `npm run start:dev`
- [ ] Server health check passes: `curl http://localhost:3000/health`

---

## Manual Test 1: Basic Payment Flow

### Setup
```bash
# Create test users
# User A: Phone +1234567890 (role: USER)
# User B: Phone +0987654321 (role: HOST)

# Give User A 100 coins via admin API
POST /api/v1/wallet/recharge
Body: {
  "userId": "<User A ID>",
  "amount": 100,
  "coinType": "GIFT_COINS"
}
```

### Test Steps
1. Connect User A to WebSocket chat
2. Connect User B to WebSocket chat
3. User A sends message: "Hello"
4. Observe console logs (should see [PAYMENT] logs)

### Expected Results

**User A (Sender):**
- [ ] Receives `messageAck` event
- [ ] Receives `paymentConfirmed` event with:
  - [ ] `senderCoins: 90` (was 100)
  - [ ] `coinDeducted: 10`
  - [ ] `diamondsCredited: 10`
- [ ] UI updates to show 90 coins

**User B (Receiver):**
- [ ] Receives `newMessage` event
- [ ] Receives `walletUpdated` event with:
  - [ ] `diamonds: 10` (was 0)
  - [ ] `diamondsCredited: 10`
- [ ] UI updates to show 10 diamonds

---

## Manual Test 2: Verify Database Updates

### Query User A's Wallet
```sql
SELECT * FROM wallets WHERE "userId" = '<User A ID>';
```

**Expected:**
```
giftCoins: 90
gameCoins: 0
diamonds: 0
```

### Query User B's Wallet
```sql
SELECT * FROM wallets WHERE "userId" = '<User B ID>';
```

**Expected:**
```
giftCoins: 0
gameCoins: 0
diamonds: 10
promoDiamonds: 0
```

### Query Transaction Record
```sql
SELECT * FROM transactions 
WHERE type = 'CHAT_PAYMENT' 
AND "senderId" = '<User A ID>'
ORDER BY "createdAt" DESC 
LIMIT 1;
```

**Expected:**
```
type: CHAT_PAYMENT
status: COMPLETED
senderId: <User A ID>
receiverId: <User B ID>
coinAmount: 10
diamondAmount: 10
```

---

## Manual Test 3: Console Log Verification

### Look for these logs:
```
[PAYMENT] Starting chat payment: <uuid> → <uuid>, coins: 10, diamonds: 10
[PAYMENT] Sender wallet before payment - giftCoins: 100, gameCoins: 0, total: 100
[PAYMENT] Sender wallet after deduction - giftCoins: 90, gameCoins: 0, total: 90
[PAYMENT] Receiver wallet before credit - diamonds: 0, promoDiamonds: 0
[PAYMENT] Receiver wallet after credit - diamonds: 10, promoDiamonds: 0
[PAYMENT] Transaction created: <uuid>, type: CHAT_PAYMENT, status: COMPLETED
[PAYMENT] Transaction completed successfully: <uuid>
```

- [ ] All logs appear in correct order
- [ ] Numbers are correct
- [ ] No error logs

---

## Manual Test 4: Multiple Messages

Send 3 messages from User A to User B.

### Expected Results:
- [ ] User A coins: 100 → 90 → 80 → 70
- [ ] User B diamonds: 0 → 10 → 20 → 30
- [ ] All 3 transactions recorded in database
- [ ] All 3 transaction records have status COMPLETED

### Verify Database:
```sql
SELECT COUNT(*) FROM transactions 
WHERE type = 'CHAT_PAYMENT' 
AND "senderId" = '<User A ID>';
-- Expected: 3
```

---

## Manual Test 5: Free Message (Mutual Follow)

1. Make User A and User B mutually follow each other
2. User A sends message to User B

### Expected Results:
- [ ] No `paymentConfirmed` event (or event with coinDeducted: 0)
- [ ] User A coins stay at current value (no deduction)
- [ ] User B diamonds stay at current value (no credit)
- [ ] Message still delivered successfully

---

## Manual Test 6: Insufficient Balance

1. User A has 5 coins (less than 10 cost)
2. User A tries to send message to User B

### Expected Results:
- [ ] `messageError` event received with:
  - [ ] `error: "Insufficient balance..."`
- [ ] User A coins remain 5
- [ ] User B diamonds unchanged
- [ ] No transaction record created

---

## Manual Test 7: Idempotency

1. User A sends message with idempotencyKey: "test-123"
2. Server crashes (kill process)
3. Restart server
4. User A resends same message with same idempotencyKey: "test-123"

### Expected Results:
- [ ] Same messageId returned both times
- [ ] Same transactionId returned both times
- [ ] Only one message created in database
- [ ] Only one transaction record created
- [ ] No duplicate charges

**Verify:**
```sql
SELECT COUNT(*) FROM messages 
WHERE "chatId" = '<chat ID>';
-- Expected: 1

SELECT COUNT(*) FROM transactions 
WHERE "idempotencyKey" LIKE 'chat-pay:%test-123%';
-- Expected: 1
```

---

## Manual Test 8: Socket Event Payload Verification

Use browser DevTools or API client to monitor socket events.

### paymentConfirmed Event
```json
{
  "transactionId": "uuid",
  "coinDeducted": 10,
  "diamondsCredited": 10,
  "senderCoins": 90,
  "senderGiftCoins": 90,
  "senderGameCoins": 0
}
```

- [ ] All fields present
- [ ] Numbers match expectations
- [ ] `senderCoins` reflects actual database value

### walletUpdated Event
```json
{
  "userId": "uuid",
  "diamonds": 10,
  "promoDiamonds": 0,
  "diamondsCredited": 10
}
```

- [ ] userId matches receiver ID
- [ ] diamonds reflects actual database value
- [ ] diamondsCredited matches transaction amount

### newMessage Event
```json
{
  "id": "uuid",
  "chatId": "uuid",
  "senderId": "uuid",
  "content": "Hello",
  "coinCost": 10,
  "diamondGenerated": 10,
  "createdAt": "2026-03-15T14:00:00.000Z"
}
```

- [ ] All fields present
- [ ] coinCost is correct
- [ ] diamondGenerated matches diamond amount

---

## Manual Test 9: Both Users See Updates

1. Connect User A and User B to same chat
2. User A sends message
3. Both users should receive notifications

### User A receives:
- [ ] `messageAck`
- [ ] `paymentConfirmed` (with their new balance)

### User B receives:
- [ ] `newMessage`
- [ ] `walletUpdated` (with their new diamonds)

---

## Manual Test 10: Endpoint Verification

### GET /api/v1/wallet/balance

**User A:**
```bash
curl -H "Authorization: Bearer <User A Token>" \
  http://localhost:3000/api/v1/wallet/balance
```

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "giftCoins": 70,
    "gameCoins": 0,
    "diamonds": 0,
    "promoDiamonds": 0,
    "totalCoins": 70
  }
}
```

- [ ] Matches database values
- [ ] totalCoins = giftCoins + gameCoins
- [ ] Response is immediate (not cached)

---

## Test Summary

| Test | Status | Notes |
|------|--------|-------|
| Basic payment flow | [ ] | User A coins deducted, User B diamonds credited |
| Database updates | [ ] | Values match expected amounts |
| Console logs | [ ] | All payment logs appear |
| Multiple messages | [ ] | Balances update correctly each time |
| Free message (mutual follow) | [ ] | No charges applied |
| Insufficient balance | [ ] | Error returned, no charge |
| Idempotency | [ ] | No duplicate charges on retry |
| Socket event payloads | [ ] | All fields present and correct |
| Both users see updates | [ ] | Real-time sync works |
| Wallet endpoint | [ ] | Returns correct balance |

---

## Debugging Commands

### Check Server Logs
```bash
# Look for [PAYMENT] logs
grep "\[PAYMENT\]" /path/to/logs
```

### Check Database
```bash
# View last payment
psql $DATABASE_URL -c "SELECT * FROM transactions WHERE type = 'CHAT_PAYMENT' ORDER BY created_at DESC LIMIT 1;"
```

### Monitor Socket Events (Frontend)
```javascript
// In browser console
socket.onAny((event, ...args) => {
  console.log(`[SOCKET] ${event}:`, args);
});
```

### Check User Wallets
```bash
psql $DATABASE_URL -c "SELECT user_id, gift_coins, game_coins, diamonds, promo_diamonds FROM wallets WHERE user_id IN ('<User A ID>', '<User B ID>');"
```

---

## Common Issues & Fixes

### Issue: paymentConfirmed not received
**Solution:** Check if WalletService is injected in ChatGateway constructor

### Issue: Wallet still shows old balance
**Solution:** Verify `senderCoins` field is being used in frontend to update UI

### Issue: Receiver doesn't see diamonds update
**Solution:** Check if frontend is listening to `walletUpdated` event

### Issue: Transaction not in database
**Solution:** Check console logs for [PAYMENT] FAILED message

### Issue: "Insufficient balance" on first message
**Solution:** Verify admin recharge was successful with GET /wallet/balance

---

## Success Criteria

✅ **Test passes if:**
- All socket events are received with correct payloads
- Database balances match frontend display
- Both users see real-time updates
- Transaction records are created
- Console logs show complete payment flow
- No errors in server logs
- Idempotency works (no duplicate charges)

---

## Notes

- Clear database with `npx prisma migrate reset --force` between test runs
- Use same chat room for both users in tests
- Monitor browser DevTools Network tab for API calls
- Check browser console for JavaScript errors
- Watch server logs in another terminal window

---

**Ready to test? Start with Test 1 and work through each checklist! 🚀**
