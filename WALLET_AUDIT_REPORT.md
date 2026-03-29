# Financial Transaction Flow Audit Report
**Date:** March 15, 2026  
**Status:** ⚠️ CRITICAL ISSUE FOUND - Wallet updates not communicated to frontend

---

## 1️⃣ Message Payment Flow - ✅ VERIFIED

The backend flow executes correctly:

```
sendMessage (chat.gateway.ts)
  ↓
chatService.sendMessage (chat.service.ts)
  ↓
walletService.processChatPayment (wallet.service.ts)
  ↓
  [ATOMIC TRANSACTION]
  - Deduct coins from sender wallet
  - Credit diamonds to receiver wallet
  - Create CHAT_PAYMENT transaction record
  - Process agency commission (if applicable)
  ↓
emit messageAck (to sender)
emit paymentConfirmed (to sender) ← ⚠️ INCOMPLETE
```

---

## 2️⃣ Wallet Mutation - ✅ VERIFIED

**File:** [wallet.service.ts](wallet.service.ts#L253-L285)

The wallet mutations are correctly implemented inside `prisma.$transaction`:

```typescript
// 1. Deduct from sender
await tx.wallet.update({
  where: { userId: senderId },
  data: {
    gameCoins: { decrement: gameCoinsDeducted },
    giftCoins: { decrement: giftCoinsDeducted },
  },
});

// 3. Credit diamonds to receiver
await tx.wallet.update({
  where: { userId: receiverId },
  data: usePromoDiamonds
    ? { promoDiamonds: { increment: diamondGenerated } }
    : { diamonds: { increment: diamondGenerated } },
});
```

**Status:** ✅ Both updates are inside the same atomic transaction with Serializable isolation.

---

## 3️⃣ Transaction Record - ✅ VERIFIED

**File:** [wallet.service.ts](wallet.service.ts#L302-L320)

A transaction record is created with:

```typescript
const transaction = await tx.transaction.create({
  data: {
    idempotencyKey,
    type: TransactionType.CHAT_PAYMENT,
    senderId,
    receiverId,
    coinAmount: coinCost,
    diamondAmount: diamondGenerated,
    status: TransactionStatus.COMPLETED,
    description: usePromoDiamonds
      ? 'Chat message payment (referral pair — promo diamonds)'
      : 'Chat message payment',
    metadata: {
      gameCoinsDeducted,
      giftCoinsDeducted,
      usePromoDiamonds,
    },
  },
});
```

**Status:** ✅ All expected fields present.

---

## 4️⃣ Socket Event Emission - ❌ **CRITICAL ISSUE**

**File:** [chat.gateway.ts](chat.gateway.ts#L211-L219)

Current implementation:

```typescript
if (result.transaction) {
  client.emit('paymentConfirmed', {
    transactionId: result.transaction.transactionId,
    coinDeducted: result.transaction.coinAmount,
  });
}
```

**Problems Identified:**

1. **Missing updated wallet balances:** The event only sends `coinDeducted`, not the **new sender coin balance**
2. **Receiver not notified:** The receiver doesn't receive any wallet update event
3. **No wallet state update:** Frontend has no way to know the new balance without polling GET /wallet/balance
4. **Inconsistent event data:** Expected event structure should include:
   - Sender's new coins/diamonds
   - Receiver's new diamonds
   - Or fetch wallets and emit them

---

## 5️⃣ Wallet Endpoint - ✅ VERIFIED

**File:** [wallet.controller.ts](wallet.controller.ts#L18-L21)

Endpoint exists and returns correct structure:

```typescript
@Get('balance')
async getBalance(@CurrentUser() user: JwtPayload) {
  return this.walletService.getBalance(user.sub);
}
```

Response format from [wallet.service.ts](wallet.service.ts#L107-L122):

```typescript
{
  giftCoins: number,
  gameCoins: number,
  diamonds: number,
  promoDiamonds: number,
  totalCoins: number
}
```

**Status:** ✅ Endpoint exists and response is correct.

---

## 6️⃣ Database Verification

**Confirmed in wallet.service.ts:**

✅ Deducting coins uses a priority system:
- Game coins first
- Then gift coins

✅ Diamonds increment atomically

✅ Row-level locks prevent race conditions:
```typescript
SELECT * FROM wallets WHERE "userId" = ${senderId}::uuid FOR UPDATE
```

✅ Transaction isolation level is Serializable (strongest)

---

## Root Cause Analysis

**Why frontend shows 0 coins/diamonds:**

1. ✅ Backend updates DB correctly
2. ✅ Backend persists transaction record
3. ❌ **Backend does NOT emit updated wallet balances over WebSocket**
4. ❌ **Frontend never receives which wallet state changed**
5. ❌ **Frontend shows stale cached balance (likely 0 from initialization)**

**The Issue:** The frontend likely depends on the `paymentConfirmed` socket event to update UI, but the event is missing the updated wallet values.

---

## Solution Required

The backend must:

1. **Fetch updated wallet balances** after transaction commits
2. **Emit `paymentConfirmed` event with full wallet state**
3. **Broadcast wallet update to both users** (sender AND receiver)

Example of what should be emitted:

```typescript
client.emit('paymentConfirmed', {
  transactionId: result.transaction.transactionId,
  senderCoins: updatedSenderWallet.totalCoins,
  receiverDiamonds: updatedReceiverWallet.diamonds,
  coinDeducted: result.transaction.coinAmount,
  diamondCredited: result.transaction.diamondAmount,
});

// AND broadcast to receiver
server.to(`chat:${chatId}`).emit('walletUpdated', {
  userId: receiverId,
  diamonds: updatedReceiverWallet.diamonds,
  diamondGenerated,
});
```

---

## Summary

| Component | Status | Finding |
|-----------|--------|---------|
| Message flow | ✅ OK | Executes correctly |
| Wallet deduction | ✅ OK | Atomically updated |
| Diamond credit | ✅ OK | Atomically updated |
| Transaction record | ✅ OK | Properly logged |
| Socket event emission | ❌ **BROKEN** | Missing wallet state |
| Wallet endpoint | ✅ OK | Returns correct data |
| DB integrity | ✅ OK | Serializable, locked rows |

**Critical Issue:** Frontend receives payment confirmation but no updated wallet balances, so UI never updates.
