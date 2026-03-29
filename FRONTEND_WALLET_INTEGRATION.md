# Frontend Wallet Integration Guide

**For Frontend Developers:** Socket Events for Wallet Updates

---

## Quick Setup

Your frontend WebSocket listeners should handle these events:

### 1. Message Acknowledgment (Always Sent)

```javascript
socket.on('messageAck', (data) => {
  console.log('Message sent successfully!', data);
  // Update UI: show message was delivered
});
```

**Payload:**
```javascript
{
  chatId: "uuid",
  idempotencyKey: "string",
  messageId: "uuid",
  createdAt: "2026-03-15T12:00:00Z"
}
```

---

### 2. Payment Confirmation (When Coins Are Charged)

```javascript
socket.on('paymentConfirmed', (data) => {
  console.log('Payment confirmed!', data);
  
  // Update sender's wallet UI
  updateSenderWallet({
    totalCoins: data.senderCoins,
    giftCoins: data.senderGiftCoins,
    gameCoins: data.senderGameCoins,
  });
  
  // Show transaction confirmation
  showToast(`Sent ${data.diamondsCredited} diamonds (${data.coinDeducted} coins)`);
});
```

**Payload:**
```javascript
{
  transactionId: "uuid",
  coinDeducted: 10,           // How many coins were deducted
  diamondsCredited: 10,       // How many diamonds were created
  senderCoins: 90,            // NEW SENDER BALANCE (total coins)
  senderGiftCoins: 90,        // Breakdown: gift coins
  senderGameCoins: 0          // Breakdown: game coins
}
```

**When it's sent:** After a message is sent and the payment is processed successfully.

---

### 3. Wallet Updated (Receiver Gets Diamonds)

```javascript
socket.on('walletUpdated', (data) => {
  console.log('Wallet updated!', data);
  
  // Update receiver's wallet UI
  updateReceiverWallet({
    diamonds: data.diamonds,
    promoDiamonds: data.promoDiamonds,
  });
  
  // Show earning notification
  showToast(`You earned ${data.diamondsCredited} diamonds!`);
});
```

**Payload:**
```javascript
{
  userId: "uuid",             // Whose wallet was updated
  diamonds: 10,               // NEW RECEIVER BALANCE (diamonds)
  promoDiamonds: 0,           // Non-withdrawable promotional diamonds
  diamondsCredited: 10        // How many were just credited
}
```

**When it's sent:** When someone sends you a message that generates diamonds (USER → HOST).

---

### 4. New Message Received

```javascript
socket.on('newMessage', (message) => {
  console.log('New message!', message);
  
  // Add message to chat UI
  addMessageToChat(message);
  
  // If this is from someone else, update their info
  if (message.senderId !== currentUserId) {
    updateChatUI({
      senderName: getSenderName(message.senderId),
      messageCount: messageCount + 1,
    });
  }
});
```

**Payload:**
```javascript
{
  id: "uuid",
  chatId: "uuid",
  senderId: "uuid",
  content: "Hello!",
  coinCost: 10,               // Coins charged (0 if free)
  diamondGenerated: 10,       // Diamonds generated (0 if none)
  createdAt: "2026-03-15T12:00:00Z"
}
```

**When it's sent:** To all participants in the chat when a message is sent.

---

### 5. Error Handling

```javascript
socket.on('messageError', (error) => {
  console.error('Message sending failed!', error);
  
  // Show error to user
  showErrorToast(error.error);
  
  // If using idempotency keys, remove the message from pending
  removePendingMessage(error.idempotencyKey);
});
```

**Payload:**
```javascript
{
  idempotencyKey: "string",
  error: "Insufficient balance"  // Error message
}
```

**Possible errors:**
- `Insufficient balance` - Not enough coins
- `Message exceeds maximum length` - Content too long
- `Suspicious activity detected` - Fraud detection triggered
- `You are not a participant of this chat` - Permission denied
- Various other validation errors

---

## Complete Integration Example

```javascript
import { io } from 'socket.io-client';

class ChatManager {
  constructor(userId, token) {
    this.userId = userId;
    this.socket = io('http://your-backend/chat', {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    this.setupListeners();
  }

  setupListeners() {
    // Message was sent
    this.socket.on('messageAck', (data) => {
      console.log('✓ Message delivered');
      this.updateUIMessageStatus(data.messageId, 'delivered');
    });

    // Payment was processed
    this.socket.on('paymentConfirmed', (data) => {
      console.log('✓ Payment confirmed');
      
      // UPDATE YOUR WALLET STATE
      this.updateWalletUI({
        coins: data.senderCoins,
        giftCoins: data.senderGiftCoins,
        gameCoins: data.senderGameCoins,
      });
      
      // Show notification
      this.showNotification(
        `Message sent! -${data.coinDeducted} coins`
      );
    });

    // Someone else's wallet was updated
    this.socket.on('walletUpdated', (data) => {
      console.log('✓ Wallet updated for:', data.userId);
      
      // If it's the other person in current chat
      if (data.userId === this.otherUserId) {
        this.updateOtherUserUI({
          diamonds: data.diamonds,
          diamondsJustEarned: data.diamondsCredited,
        });
        
        this.showNotification(
          `Host earned ${data.diamondsCredited} diamonds!`
        );
      }
    });

    // New message in chat
    this.socket.on('newMessage', (message) => {
      console.log('✓ New message:', message.content);
      
      // Add to chat display
      this.addMessageToChat(message);
      
      // Show if message cost coins
      if (message.coinCost > 0) {
        console.log(`Message cost ${message.coinCost} coins`);
      }
    });

    // Error
    this.socket.on('messageError', (error) => {
      console.error('✗ Error:', error.error);
      
      this.showErrorNotification(error.error);
      
      // If sending failed, remove from pending
      if (error.idempotencyKey) {
        this.removePendingMessage(error.idempotencyKey);
      }
    });
  }

  sendMessage(chatId, content) {
    // Generate idempotency key for deduplication
    const idempotencyKey = `msg-${Date.now()}-${Math.random()}`;

    // Emit message
    this.socket.emit('sendMessage', {
      chatId,
      content,
      idempotencyKey,
    });

    // Add to UI as pending
    this.addPendingMessage({
      content,
      idempotencyKey,
      status: 'pending',
    });
  }

  updateWalletUI(wallet) {
    // Update your React state / Vue data / etc
    this.state.wallet = {
      ...this.state.wallet,
      ...wallet,
    };
    // Re-render component
    this.render();
  }

  addMessageToChat(message) {
    // Update message list in UI
  }

  showNotification(message) {
    // Toast notification
  }

  showErrorNotification(message) {
    // Error toast
  }
}
```

---

## Debugging Checklist

- [ ] Are you listening for `paymentConfirmed`?
- [ ] Are you updating wallet UI when `paymentConfirmed` arrives?
- [ ] Are you using the `senderCoins` value from the event?
- [ ] Are you listening for `walletUpdated` for other users?
- [ ] Are you handling `messageError` events?
- [ ] Are you using idempotency keys to prevent duplicates?
- [ ] Do you remove pending messages on `messageAck`?

---

## Common Issues & Fixes

### Issue: Wallet still shows 0 after message sent

**Cause:** Not listening to `paymentConfirmed` event  
**Fix:** Add the socket listener for `paymentConfirmed`

```javascript
socket.on('paymentConfirmed', (data) => {
  updateWallet(data.senderCoins);
});
```

### Issue: Only sender's wallet updates, receiver's doesn't

**Cause:** Receiver not listening to `walletUpdated` event  
**Fix:** Both users need to listen to `walletUpdated`

### Issue: Messages appear but no wallet update

**Cause:** Payment may have failed silently  
**Fix:** Check browser console for `messageError` events

### Issue: Duplicate messages appearing

**Cause:** Not using idempotency keys  
**Fix:** Generate unique `idempotencyKey` for each message send

---

## Field Reference

| Field | Sent By | Meaning |
|-------|---------|---------|
| `senderCoins` | paymentConfirmed | User's new total coin balance |
| `senderGiftCoins` | paymentConfirmed | User's gift coins (separate pool) |
| `senderGameCoins` | paymentConfirmed | User's game coins (separate pool) |
| `coinDeducted` | paymentConfirmed | How many coins were charged |
| `diamondsCredited` | paymentConfirmed | How many diamonds were created |
| `diamonds` | walletUpdated | User's new diamond balance |
| `diamondsCredited` | walletUpdated | How many were just earned |
| `promoDiamonds` | walletUpdated | Non-withdrawable promotional diamonds |

---

## Performance Tips

1. **Use idempotency keys:** Prevents duplicate processing if user retries
2. **Local optimistic updates:** Update UI immediately, confirm with socket event
3. **Debounce wallet fetches:** Don't call GET /wallet/balance on every event
4. **Cache wallet state:** Use the socket events instead of polling

---

## For Testing

Use browser DevTools to monitor socket events:

```javascript
// In browser console
socket.onAny((event, ...args) => {
  console.log(event, args);
});
```

You'll see all socket events and their payloads.
