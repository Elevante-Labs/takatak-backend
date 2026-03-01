import { TransactionType, TransactionStatus } from '@prisma/client';

export interface CreateTransactionParams {
  type: TransactionType;
  senderId?: string;
  receiverId?: string;
  coinAmount?: number;
  diamondAmount?: number;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface ChatPaymentParams {
  senderId: string;
  receiverId: string;
  coinCost: number;
  diamondGenerated: number;
  /** If true, diamonds are credited as promoDiamonds (non-withdrawable) */
  usePromoDiamonds?: boolean;
  /** Idempotency key to prevent duplicate processing */
  idempotencyKey?: string;
}

export interface WalletBalance {
  giftCoins: number;
  gameCoins: number;
  diamonds: number;
  promoDiamonds: number;
  totalCoins: number;
}

export interface TransactionResult {
  transactionId: string;
  status: TransactionStatus;
  coinAmount: number;
  diamondAmount: number;
}
