# 📊 Wallet Update Flow - Visual Diagrams

---

## Before Fix ❌

### Message Send Flow (Broken)
```
┌─────────────────────────────────────────────────────────────┐
│                    USER A SENDS MESSAGE                     │
│                         (100 coins)                          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                 chat.gateway.ts                             │
│              handleSendMessage()                            │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                 chat.service.ts                             │
│              sendMessage()                                  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              wallet.service.ts                              │
│         processChatPayment()                                │
│                                                             │
│  USER A: 100 → 90 coins ✓                                  │
│  USER B: 0 → 10 diamonds ✓                                 │
│  DB: Transaction recorded ✓                                │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│            Socket Event Emission                            │
│                                                             │
│  client.emit('paymentConfirmed', {                         │
│    transactionId: 'uuid',                                  │
│    coinDeducted: 10                                        │
│  });  ← Only coin amount, no balance info ✗               │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│            Frontend Wallet Display                          │
│                                                             │
│  Wallet: 0 coins  ← Still shows 0 ✗                        │
│  No way to know the new balance!                           │
└─────────────────────────────────────────────────────────────┘
```

---

## After Fix ✅

### Message Send Flow (Working)
```
┌─────────────────────────────────────────────────────────────┐
│                    USER A SENDS MESSAGE                     │
│                         (100 coins)                          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                 chat.gateway.ts                             │
│              handleSendMessage()                            │
│         (Now has WalletService injected)                    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                 chat.service.ts                             │
│              sendMessage()                                  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              wallet.service.ts                              │
│         processChatPayment()                                │
│                                                             │
│  USER A: 100 → 90 coins ✓                                  │
│  USER B: 0 → 10 diamonds ✓                                 │
│  DB: Transaction recorded ✓                                │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│         Fetch Updated Balances (NEW!)                       │
│                                                             │
│  senderWallet = getBalance(userA)                          │
│    → {coins: 90, giftCoins: 90, gameCoins: 0}             │
│                                                             │
│  receiverWallet = getBalance(userB)                        │
│    → {diamonds: 10, promoDiamonds: 0}                      │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│        Socket Event Emission (Enhanced!)                    │
│                                                             │
│  TO USER A:                                                │
│  client.emit('paymentConfirmed', {                         │
│    transactionId: 'uuid',                                  │
│    coinDeducted: 10,                                       │
│    senderCoins: 90,         ← NEW ✓                        │
│    senderGiftCoins: 90,     ← NEW ✓                        │
│    senderGameCoins: 0       ← NEW ✓                        │
│  });                                                        │
│                                                             │
│  TO ALL IN CHAT (NEW!):                                    │
│  server.to('chat:xyz').emit('walletUpdated', {            │
│    userId: userB,                                          │
│    diamonds: 10,            ← NEW ✓                        │
│    promoDiamonds: 0,        ← NEW ✓                        │
│    diamondsCredited: 10     ← NEW ✓                        │
│  });                                                        │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│            Frontend Wallet Display                          │
│                                                             │
│  USER A:                                                   │
│  Wallet: 0 → 90 coins  ✓ (Updated!)                        │
│                                                             │
│  USER B:                                                   │
│  Wallet: 0 → 10 diamonds ✓ (Updated!)                      │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Flow Comparison

### Before Fix
```
Message → Process Payment → DB Update → Event Sent (missing data) → No Update
                                                         ↑
                                               Frontend has no info!
```

### After Fix
```
Message → Process Payment → DB Update → Fetch Balances → Event Sent (with data) → Update!
                                               ↓
                                     [90 coins, 10 diamonds]
                                               ↓
                                        Both users notified
                                               ↓
                                         UI updates in sync
```

---

## Component Interaction Diagram

### Before Fix
```
┌──────────────────┐                    ┌──────────────────┐
│   ChatGateway    │                    │  WalletService   │
│                  │                    │                  │
│  handleSend      │───Process────→     │  processChatPayment
│  Message         │  Payment           │                  │
│                  │                    │  ✓ Deducts coins │
│  ✗ No wallet     │◄───Returns──────   │  ✓ Credits diamonds
│    service       │  transaction       │  ✓ Creates tx    │
└──────────────────┘                    └──────────────────┘
         │
         │ emit paymentConfirmed
         │ (only coin amount)
         ↓
    ✗ Frontend doesn't know new balance
```

### After Fix
```
┌──────────────────────────────────────────────────────────────┐
│   ChatGateway                                                │
│                                                              │
│  handleSendMessage()                                         │
│  ├─→ chatService.sendMessage()                              │
│  │                                                           │
│  └─→ result = transaction (senderId, receiverId)            │
│      │                                                       │
│      ├─→ walletService.getBalance(senderId)    ← NEW       │
│      │   → returns {coins: 90, ...}                        │
│      │                                                       │
│      ├─→ walletService.getBalance(receiverId)  ← NEW       │
│      │   → returns {diamonds: 10, ...}                     │
│      │                                                       │
│      └─→ Emit with complete wallet state       ← NEW       │
│          paymentConfirmed (to sender)                       │
│          walletUpdated (broadcast to room)                  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
                         │
                         ↓
            ✓ Frontend gets complete info
```

---

## Event Emission Timeline

### Before Fix
```
0ms   ├─ Message starts
5ms   ├─ Validation
10ms  ├─ Payment processing
      │  ├─ Deduct coins
      │  ├─ Credit diamonds
      │  └─ Create transaction
15ms  ├─ emit paymentConfirmed
      │  {transactionId, coinDeducted}  ← Missing data!
20ms  └─ End

Problem: Event has no wallet state info
```

### After Fix
```
0ms   ├─ Message starts
5ms   ├─ Validation
10ms  ├─ Payment processing
      │  ├─ Deduct coins
      │  ├─ Credit diamonds
      │  └─ Create transaction
15ms  ├─ Fetch sender balance    ← NEW (5ms)
20ms  ├─ Fetch receiver balance  ← NEW (5ms)
25ms  ├─ emit paymentConfirmed   ← NEW (with balances)
      │  {
      │    transactionId,
      │    coinDeducted,
      │    senderCoins: 90,    ← NEW
      │    senderGiftCoins,    ← NEW
      │    senderGameCoins,    ← NEW
      │  }
30ms  ├─ emit walletUpdated      ← NEW (broadcast)
      │  {
      │    userId,
      │    diamonds: 10,        ← NEW
      │    diamondsCredited,    ← NEW
      │  }
35ms  └─ End

Benefit: Event has complete wallet state (only +10ms overhead)
```

---

## Database Transaction Flow

```
                    ┌─────────────────────────────────┐
                    │   Atomic Transaction             │
                    │   (Serializable Isolation)       │
                    └─────────────────────────────────┘
                              ↓
         ┌────────────────────────────────────────────────┐
         │                                                │
    ┌────▼────┐                                      ┌────▼────┐
    │  Sender │                                      │ Receiver│
    │ Wallet  │                                      │ Wallet  │
    └────┬────┘                                      └────┬────┘
         │                                                │
         │ FOR UPDATE (Lock)                             │
         ├─ Read: 100 coins                              │
         ├─ Check: >= 10? YES ✓                          │
         │                                                │
         ├─ Deduct 10 coins                              │ FOR UPDATE (Lock)
         │  gameCoins: 0 → 0                             │
         │  giftCoins: 100 → 90                          │ Read: 0 diamonds
         │                                                │
         │                                                │ Credit 10 diamonds
         │                                                │ diamonds: 0 → 10
         │                                                │
         ├─────────────────────────────────────────────┤
         │  CREATE TRANSACTION RECORD                  │
         │  ├─ id: uuid                                │
         │  ├─ type: CHAT_PAYMENT                      │
         │  ├─ senderId, receiverId                    │
         │  ├─ coinAmount: 10                          │
         │  ├─ diamondAmount: 10                       │
         │  └─ status: COMPLETED                       │
         ├─────────────────────────────────────────────┤
         │                                                │
         └────────────────────────────────────────────────┘
                              ↓
                    ✓ COMMIT (All or Nothing)
                              ↓
            Updates visible to application
                              ↓
            Fetch updated balances (NEW!)
                              ↓
            Emit socket events (NEW!)
```

---

## Socket Event Architecture

### Message Sending
```
Frontend (User A)
    │
    ├─ socket.emit('sendMessage', {
    │      chatId: 'xyz',
    │      content: 'Hello',
    │      idempotencyKey: 'key-123'
    │  })
    │
    └──────────────────────────────────┬─────────────────────────────┐
                                       ↓                             ↓
                        chat.gateway.ts                    User B (Receiver)
                      handleSendMessage
                              │
                              ├─→ chatService.sendMessage()
                              │
                              ├─→ walletService.processChatPayment()
                              │       ├─ Deduct coins
                              │       ├─ Credit diamonds
                              │       └─ Create transaction
                              │
                              ├─→ Fetch balances (NEW!)
                              │
                              ├─ socket.emit('messageAck', ...)
                              │           ↓
                              │    Confirms to User A
                              │
                              ├─ socket.emit('paymentConfirmed', {...})
                              │    (with wallet balances - NEW!)
                              │           ↓
                              │    User A UI updates (NEW!)
                              │
                              ├─ server.to('chat:xyz').emit('newMessage', ...)
                              │           ↓
                              │    Sent to both users
                              │
                              └─ server.to('chat:xyz').emit('walletUpdated', ...)
                                      (with receiver diamonds - NEW!)
                                           ↓
                                    User B wallet updates (NEW!)
```

---

## State Change Diagram

### Before Fix (❌ Stale State)
```
Frontend State            Backend State          Database State
═══════════════════════   ═════════════════════  ══════════════════

User A Wallet             
coins: 100                coins: 100             coins: 100
                          ↓ (send message)       ↓
                          coins: 90              coins: 90
                          (No notification) ✗    
coins: 100 ✗              
(Stale!)                  

User B Wallet             
diamonds: 0               diamonds: 0            diamonds: 0
                          ↓ (send message)       ↓
                          diamonds: 10           diamonds: 10
                          (No notification) ✗    
diamonds: 0 ✗             
(Stale!)                  
```

### After Fix (✓ Synchronized State)
```
Frontend State            Backend State          Database State
═══════════════════════   ═════════════════════  ══════════════════

User A Wallet             
coins: 100                coins: 100             coins: 100
  ↓ (receives event)      ↓ (process)            ↓ (commit)
coins: 90 ✓               coins: 90              coins: 90
(Synced!)                 (in transaction)       
                          ↓ (fetch & emit)       
                          Emit: coins: 90        
                             ↓                  
                           [Socket event]        
                             ↓                  
                          coins: 90 ✓            

User B Wallet             
diamonds: 0               diamonds: 0            diamonds: 0
  ↓ (receives event)      ↓ (process)            ↓ (commit)
diamonds: 10 ✓            diamonds: 10           diamonds: 10
(Synced!)                 (in transaction)       
                          ↓ (fetch & emit)       
                          Emit: diamonds: 10     
                             ↓                  
                           [Socket event]        
                             ↓                  
                          diamonds: 10 ✓         
```

---

## Error Handling Flow

```
┌─────────────────────────────────────────────────────────┐
│                 Message Send Initiated                  │
└─────────────────────────────────────────────────────────┘
                         ↓
         ┌───────────────┴───────────────┐
         ↓                               ↓
    ┌────────────┐            ┌──────────────────┐
    │  Content   │            │  Wallet Check    │
    │ Validation │            │                  │
    └─────┬──────┘            │  Sufficient      │
          │                   │  balance?        │
          ├─ Too long?        │                  │
          │  ✗ messageError   └────┬────────┬────┘
          │                        ✓ YES   ✗ NO
          ├─ Empty?               │        │
          │  ✗ messageError        │      messageError
          │                        │      "Insufficient
          └─ Valid? ✓             │       balance"
                                  │
                                  ↓
                    ┌─────────────────────────┐
                    │ Process Payment (tx)    │
                    └────────┬────────────────┘
                             │
                    ┌────────┴────────┐
                    ↓                 ↓
            ✓ Success         ✗ Failure (Rollback)
              │                   │
              ├─ messageAck       └─ messageError
              │                      "Payment failed"
              ├─ paymentConfirmed
              │  (with balances)   
              │                   
              └─ walletUpdated    
                 (broadcast)      
```

---

## Summary

**Before Fix:**
- Data flow broke at the gateway
- Frontend never learned about new balances
- Required manual polling (inefficient)
- Created mismatch between frontend and backend state

**After Fix:**
- Data flows completely from backend to frontend
- Socket events carry full wallet state
- Real-time synchronization achieved
- Both users see updates instantly
- No polling needed

**Key Improvement:**
```
Broken: Message → Payment → DB ✓ → No notification → Stale UI
Fixed:  Message → Payment → DB ✓ → Fetch Balance → Event → Updated UI ✓
```
