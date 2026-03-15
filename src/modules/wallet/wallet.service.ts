import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  InternalServerErrorException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { TransactionType, TransactionStatus, Prisma } from '@prisma/client';
import {
  ChatPaymentParams,
  WalletBalance,
  TransactionResult,
} from './interfaces/wallet.interfaces';
import { CoinType } from './dto/recharge.dto';
import {
  getPaginationParams,
  buildPaginatedResult,
} from '../../common/utils/pagination.util';
import { GiftProcessorService } from './gift-processor.service';
import { AgencyService } from '../agency/agency.service';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Optional() private readonly giftProcessor?: GiftProcessorService,
    @Optional() private readonly agencyService?: AgencyService,
  ) { }

  // ──────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────

  /**
   * Check if an operation with the given idempotency key was already completed.
   * Returns the existing transaction result if found, null otherwise.
   */
  private async checkIdempotency(idempotencyKey: string): Promise<TransactionResult | null> {
    if (!idempotencyKey) return null;

    const existing = await this.prisma.transaction.findUnique({
      where: { idempotencyKey },
    });

    if (existing && existing.status === TransactionStatus.COMPLETED) {
      return {
        transactionId: existing.id,
        status: existing.status,
        coinAmount: existing.coinAmount,
        diamondAmount: existing.diamondAmount,
      };
    }

    return null;
  }

  /**
   * Record a FAILED transaction for auditing purposes.
   * This runs outside the rolled-back transaction so it persists.
   */
  private async logFailedTransaction(
    type: TransactionType,
    error: string,
    params: {
      idempotencyKey?: string;
      senderId?: string;
      receiverId?: string;
      coinAmount?: number;
      diamondAmount?: number;
    },
  ): Promise<void> {
    try {
      await this.prisma.transaction.create({
        data: {
          idempotencyKey: params.idempotencyKey
            ? `FAILED:${params.idempotencyKey}`
            : undefined,
          type,
          senderId: params.senderId,
          receiverId: params.receiverId,
          coinAmount: params.coinAmount ?? 0,
          diamondAmount: params.diamondAmount ?? 0,
          status: TransactionStatus.FAILED,
          description: `FAILED: ${error}`,
        },
      });
    } catch (logErr) {
      this.logger.error(
        `Failed to log FAILED transaction: ${(logErr as Error).message}`,
      );
    }
  }

  // ──────────────────────────────────────────
  // Read operations
  // ──────────────────────────────────────────

  /**
   * Get wallet balance for a user.
   */
  async getBalance(userId: string): Promise<WalletBalance> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }

    return {
      giftCoins: wallet.giftCoins,
      gameCoins: wallet.gameCoins,
      diamonds: wallet.diamonds,
      promoDiamonds: wallet.promoDiamonds,
      totalCoins: wallet.giftCoins + wallet.gameCoins,
    };
  }

  /**
   * Ensure wallet exists for user; create if not.
   */
  async ensureWallet(userId: string) {
    let wallet = await this.prisma.wallet.findUnique({ where: { userId } });

    if (!wallet) {
      wallet = await this.prisma.wallet.create({
        data: { userId },
      });
    }

    return wallet;
  }

  // ──────────────────────────────────────────
  // Write operations (all idempotent + FAILED logging)
  // ──────────────────────────────────────────

  /**
   * Recharge coins — admin or payment gateway initiated.
   * Uses DB transaction for atomicity.
   */
  async recharge(
    userId: string,
    amount: number,
    coinType: CoinType,
    description?: string,
    idempotencyKey?: string,
  ): Promise<TransactionResult> {
    if (amount <= 0) {
      throw new BadRequestException('Recharge amount must be positive');
    }

    // Idempotency guard
    if (idempotencyKey) {
      const existing = await this.checkIdempotency(idempotencyKey);
      if (existing) return existing;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.findUnique({ where: { userId } });

        if (!wallet) {
          throw new NotFoundException('Wallet not found');
        }

        const updateData: Prisma.WalletUpdateInput =
          coinType === CoinType.GAME
            ? { gameCoins: { increment: amount } }
            : { giftCoins: { increment: amount } };

        await tx.wallet.update({
          where: { userId },
          data: updateData,
        });

        const transaction = await tx.transaction.create({
          data: {
            idempotencyKey,
            type: TransactionType.RECHARGE,
            receiverId: userId,
            coinAmount: amount,
            status: TransactionStatus.COMPLETED,
            description: description || `${coinType} coin recharge`,
            metadata: { coinType },
          },
        });

        this.logger.log(
          `Recharge: ${amount} ${coinType} coins to user ${userId} (tx: ${transaction.id})`,
        );

        return {
          transactionId: transaction.id,
          status: transaction.status,
          coinAmount: transaction.coinAmount,
          diamondAmount: 0,
        };
      });
    } catch (error) {
      await this.logFailedTransaction(TransactionType.RECHARGE, (error as Error).message, {
        idempotencyKey,
        receiverId: userId,
        coinAmount: amount,
      });
      throw error;
    }
  }

  /**
   * Process chat payment — the core monetization flow.
   * Atomic: deducts coins from sender, credits diamonds to receiver,
   * AND processes agency commission inside the same transaction.
   * Rolls back on any failure. Logs FAILED record on error.
   */
  async processChatPayment(params: ChatPaymentParams): Promise<TransactionResult> {
    const {
      senderId,
      receiverId,
      coinCost,
      diamondGenerated,
      usePromoDiamonds = false,
      idempotencyKey,
    } = params;

    if (senderId === receiverId) {
      throw new BadRequestException('Cannot send payment to yourself');
    }

    if (coinCost <= 0) {
      throw new BadRequestException('Coin cost must be positive');
    }

    console.log(`[PAYMENT] Starting chat payment: ${senderId} → ${receiverId}, coins: ${coinCost}, diamonds: ${diamondGenerated}`);

    // Idempotency guard
    if (idempotencyKey) {
      const existing = await this.checkIdempotency(idempotencyKey);
      if (existing) {
        console.log(`[PAYMENT] Idempotency cache hit for key: ${idempotencyKey}`);
        return existing;
      }
    }

    // Track tier changes for post-commit event emission
    let tierChanges: Array<{ agencyId: string; oldLevel: string; newLevel: string }> = [];

    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          // CRITICAL: Acquire exclusive row lock via raw SQL.
          const senderWallets = await tx.$queryRaw<
            Array<{
              id: string;
              userId: string;
              giftCoins: number;
              gameCoins: number;
              diamonds: number;
              promoDiamonds: number;
            }>
          >(
            Prisma.sql`SELECT * FROM wallets WHERE "userId" = ${senderId}::uuid FOR UPDATE`,
          );

          const senderWallet = senderWallets[0];

          if (!senderWallet) {
            throw new NotFoundException('Sender wallet not found');
          }

          const totalCoins = senderWallet.giftCoins + senderWallet.gameCoins;
          console.log(`[PAYMENT] Sender wallet before payment - giftCoins: ${senderWallet.giftCoins}, gameCoins: ${senderWallet.gameCoins}, total: ${totalCoins}`);

          if (totalCoins < coinCost) {
            throw new BadRequestException(
              `Insufficient balance. Required: ${coinCost}, Available: ${totalCoins}`,
            );
          }

          // Deduct coins: prioritize game coins, then gift coins
          let remainingCost = coinCost;
          let gameCoinsDeducted = 0;
          let giftCoinsDeducted = 0;

          if (senderWallet.gameCoins >= remainingCost) {
            gameCoinsDeducted = remainingCost;
            remainingCost = 0;
          } else {
            gameCoinsDeducted = senderWallet.gameCoins;
            remainingCost -= gameCoinsDeducted;
            giftCoinsDeducted = remainingCost;
            remainingCost = 0;
          }

          // Validate no negative balances post-deduction
          if (senderWallet.gameCoins - gameCoinsDeducted < 0) {
            throw new InternalServerErrorException('Balance calculation error');
          }
          if (senderWallet.giftCoins - giftCoinsDeducted < 0) {
            throw new InternalServerErrorException('Balance calculation error');
          }

          // 1. Deduct from sender
          const updatedSenderWallet = await tx.wallet.update({
            where: { userId: senderId },
            data: {
              gameCoins: { decrement: gameCoinsDeducted },
              giftCoins: { decrement: giftCoinsDeducted },
            },
          });

          console.log(`[PAYMENT] Sender wallet after deduction - giftCoins: ${updatedSenderWallet.giftCoins}, gameCoins: ${updatedSenderWallet.gameCoins}, total: ${updatedSenderWallet.giftCoins + updatedSenderWallet.gameCoins}`);

          // 2. Lock receiver wallet row
          const receiverWallets = await tx.$queryRaw<
            Array<{ 
              id: string; 
              userId: string;
              diamonds: number;
              promoDiamonds: number;
            }>
          >(
            Prisma.sql`SELECT * FROM wallets WHERE "userId" = ${receiverId}::uuid FOR UPDATE`,
          );

          const receiverWalletBefore = receiverWallets[0];

          if (!receiverWalletBefore) {
            throw new NotFoundException('Receiver wallet not found');
          }

          console.log(`[PAYMENT] Receiver wallet before credit - diamonds: ${receiverWalletBefore.diamonds}, promoDiamonds: ${receiverWalletBefore.promoDiamonds}`);

          // 3. Credit diamonds to receiver
          const updatedReceiverWallet = await tx.wallet.update({
            where: { userId: receiverId },
            data: usePromoDiamonds
              ? { promoDiamonds: { increment: diamondGenerated } }
              : { diamonds: { increment: diamondGenerated } },
          });

          console.log(`[PAYMENT] Receiver wallet after credit - diamonds: ${updatedReceiverWallet.diamonds}, promoDiamonds: ${updatedReceiverWallet.promoDiamonds}`);

          // 4. Create immutable transaction record
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

          // 5. Process agency commission INSIDE the same transaction
          //    This ensures atomicity: if commission fails, entire payment rolls back.
          if (this.agencyService && !usePromoDiamonds && diamondGenerated > 0) {
            const commissionResult = await this.agencyService.processGiftCommission(
              receiverId,
              diamondGenerated,
              transaction.id,
              tx,
            );
            tierChanges = commissionResult.tierChanges;
          }

          console.log(`[PAYMENT] Transaction created: ${transaction.id}, type: ${transaction.type}, status: ${transaction.status}`);

          this.logger.log(
            `Chat payment: ${coinCost} coins from ${senderId} → ${diamondGenerated} diamonds to ${receiverId} (tx: ${transaction.id})`,
          );

          return {
            transactionId: transaction.id,
            status: transaction.status,
            coinAmount: coinCost,
            diamondAmount: diamondGenerated,
            receiverId: receiverId,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5000,
          timeout: 15000, // Extended: commission runs inside now
        },
      );

      console.log(`[PAYMENT] Transaction completed successfully: ${result.transactionId}`);

      // ── Post-commit actions (fire-and-forget) ──

      // Emit tier change events AFTER commit (edge case C)
      if (this.agencyService && tierChanges.length > 0) {
        this.agencyService.emitTierChanges(tierChanges);
      }

      // Emit commission earned event
      if (this.agencyService && !usePromoDiamonds && diamondGenerated > 0) {
        this.agencyService.emitEvent('agencyCommissionEarned', receiverId, {
          transactionId: result.transactionId,
          diamondGenerated,
        });
      }

      // Host stat recording remains fire-and-forget (not financial)
      if (this.giftProcessor && !usePromoDiamonds) {
        this.giftProcessor
          .processGiftSideEffects(receiverId, diamondGenerated)
          .catch((err) => {
            this.logger.error(`Gift side effects failed: ${(err as Error).message}`);
          });
      }

      return result;
    } catch (error) {
      console.error(`[PAYMENT] FAILED: ${(error as Error).message}`);
      await this.logFailedTransaction(TransactionType.CHAT_PAYMENT, (error as Error).message, {
        idempotencyKey,
        senderId,
        receiverId,
        coinAmount: coinCost,
        diamondAmount: diamondGenerated,
      });
      throw error;
    }
  }

  /**
   * Convert coins to diamonds at configurable ratio.
   */
  async convertCoinsToDiamonds(
    userId: string,
    coinAmount: number,
    idempotencyKey?: string,
  ): Promise<TransactionResult> {
    if (coinAmount <= 0) {
      throw new BadRequestException('Coin amount must be positive');
    }

    // Idempotency guard
    if (idempotencyKey) {
      const existing = await this.checkIdempotency(idempotencyKey);
      if (existing) return existing;
    }

    const ratio = this.configService.get<number>('wallet.coinToDiamondRatio') || 1;
    const diamondAmount = Math.floor(coinAmount * ratio);

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Acquire exclusive row lock to prevent concurrent conversion race
          const wallets = await tx.$queryRaw<
            Array<{
              id: string;
              userId: string;
              giftCoins: number;
              gameCoins: number;
              diamonds: number;
            }>
          >(
            Prisma.sql`SELECT * FROM wallets WHERE "userId" = ${userId}::uuid FOR UPDATE`,
          );

          const wallet = wallets[0];

          if (!wallet) {
            throw new NotFoundException('Wallet not found');
          }

          const totalCoins = wallet.giftCoins + wallet.gameCoins;

          if (totalCoins < coinAmount) {
            throw new BadRequestException(
              `Insufficient balance. Required: ${coinAmount}, Available: ${totalCoins}`,
            );
          }

          // Deduct coins (game coins first)
          let remaining = coinAmount;
          let gameDeduct = Math.min(wallet.gameCoins, remaining);
          remaining -= gameDeduct;
          let giftDeduct = remaining;

          await tx.wallet.update({
            where: { userId },
            data: {
              gameCoins: { decrement: gameDeduct },
              giftCoins: { decrement: giftDeduct },
              diamonds: { increment: diamondAmount },
            },
          });

          const transaction = await tx.transaction.create({
            data: {
              idempotencyKey,
              type: TransactionType.COIN_TO_DIAMOND,
              senderId: userId,
              receiverId: userId,
              coinAmount,
              diamondAmount,
              status: TransactionStatus.COMPLETED,
              description: `Converted ${coinAmount} coins to ${diamondAmount} diamonds`,
              metadata: {
                ratio,
                gameCoinsUsed: gameDeduct,
                giftCoinsUsed: giftDeduct,
              },
            },
          });

          this.logger.log(
            `Conversion: ${coinAmount} coins → ${diamondAmount} diamonds for user ${userId}`,
          );

          return {
            transactionId: transaction.id,
            status: transaction.status,
            coinAmount,
            diamondAmount,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5000,
          timeout: 10000,
        },
      );
    } catch (error) {
      await this.logFailedTransaction(
        TransactionType.COIN_TO_DIAMOND,
        (error as Error).message,
        { idempotencyKey, senderId: userId, receiverId: userId, coinAmount },
      );
      throw error;
    }
  }

  /**
   * Convert diamonds to coins (HOST side).
   * Ratio is owner-controlled via SystemSettings (DIAMOND_TO_COIN_RATIO).
   */
  async convertDiamondsToCoins(
    userId: string,
    diamondAmount: number,
    idempotencyKey?: string,
  ): Promise<TransactionResult> {
    if (diamondAmount <= 0) {
      throw new BadRequestException('Diamond amount must be positive');
    }

    // Idempotency guard
    if (idempotencyKey) {
      const existing = await this.checkIdempotency(idempotencyKey);
      if (existing) return existing;
    }

    // Fetch owner-controlled ratio from SystemSettings
    const ratioSetting = await this.prisma.systemSettings.findUnique({
      where: { key: 'DIAMOND_TO_COIN_RATIO' },
    });
    const ratio = ratioSetting ? parseFloat(ratioSetting.value) : 10;
    const coinAmount = Math.floor(diamondAmount * ratio);

    if (coinAmount <= 0) {
      throw new BadRequestException('Conversion yields zero coins');
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const wallets = await tx.$queryRaw<
            Array<{
              id: string;
              userId: string;
              diamonds: number;
              gameCoins: number;
            }>
          >(
            Prisma.sql`SELECT * FROM wallets WHERE "userId" = ${userId}::uuid FOR UPDATE`,
          );

          const wallet = wallets[0];

          if (!wallet) {
            throw new NotFoundException('Wallet not found');
          }

          if (wallet.diamonds < diamondAmount) {
            throw new BadRequestException(
              `Insufficient diamonds. Required: ${diamondAmount}, Available: ${wallet.diamonds}`,
            );
          }

          await tx.wallet.update({
            where: { userId },
            data: {
              diamonds: { decrement: diamondAmount },
              gameCoins: { increment: coinAmount },
            },
          });

          const transaction = await tx.transaction.create({
            data: {
              idempotencyKey,
              type: TransactionType.DIAMOND_TO_COIN,
              senderId: userId,
              receiverId: userId,
              coinAmount,
              diamondAmount,
              status: TransactionStatus.COMPLETED,
              description: `Converted ${diamondAmount} diamonds to ${coinAmount} coins`,
              metadata: { ratio },
            },
          });

          this.logger.log(
            `Diamond→Coin: ${diamondAmount} diamonds → ${coinAmount} coins for user ${userId}`,
          );

          return {
            transactionId: transaction.id,
            status: transaction.status,
            coinAmount,
            diamondAmount,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5000,
          timeout: 10000,
        },
      );
    } catch (error) {
      await this.logFailedTransaction(
        TransactionType.DIAMOND_TO_COIN,
        (error as Error).message,
        { idempotencyKey, senderId: userId, receiverId: userId, diamondAmount },
      );
      throw error;
    }
  }

  /**
   * Deduct diamonds for withdrawal request.
   * Called when a withdrawal request is created — locks the diamonds immediately.
   */
  async deductDiamondsForWithdrawal(
    userId: string,
    diamondAmount: number,
    idempotencyKey?: string,
  ): Promise<TransactionResult> {
    if (diamondAmount <= 0) {
      throw new BadRequestException('Diamond amount must be positive');
    }

    if (idempotencyKey) {
      const existing = await this.checkIdempotency(idempotencyKey);
      if (existing) return existing;
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const wallets = await tx.$queryRaw<
            Array<{ id: string; userId: string; diamonds: number }>
          >(
            Prisma.sql`SELECT * FROM wallets WHERE "userId" = ${userId}::uuid FOR UPDATE`,
          );

          const wallet = wallets[0];

          if (!wallet) {
            throw new NotFoundException('Wallet not found');
          }

          if (wallet.diamonds < diamondAmount) {
            throw new BadRequestException(
              `Insufficient diamonds. Required: ${diamondAmount}, Available: ${wallet.diamonds}`,
            );
          }

          await tx.wallet.update({
            where: { userId },
            data: { diamonds: { decrement: diamondAmount } },
          });

          const transaction = await tx.transaction.create({
            data: {
              idempotencyKey,
              type: TransactionType.WITHDRAWAL,
              senderId: userId,
              coinAmount: 0,
              diamondAmount,
              status: TransactionStatus.COMPLETED,
              description: `Withdrawal request: ${diamondAmount} diamonds`,
            },
          });

          this.logger.log(
            `Withdrawal deduction: ${diamondAmount} diamonds from user ${userId}`,
          );

          return {
            transactionId: transaction.id,
            status: transaction.status,
            coinAmount: 0,
            diamondAmount,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5000,
          timeout: 10000,
        },
      );
    } catch (error) {
      await this.logFailedTransaction(
        TransactionType.WITHDRAWAL,
        (error as Error).message,
        { idempotencyKey, senderId: userId, diamondAmount },
      );
      throw error;
    }
  }

  /**
   * Refund diamonds on withdrawal rejection (atomic).
   */
  async refundWithdrawalDiamonds(
    userId: string,
    diamondAmount: number,
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT * FROM wallets WHERE "userId" = ${userId}::uuid FOR UPDATE`,
        );

        await tx.wallet.update({
          where: { userId },
          data: { diamonds: { increment: diamondAmount } },
        });

        await tx.transaction.create({
          data: {
            type: TransactionType.WITHDRAWAL,
            receiverId: userId,
            diamondAmount,
            status: TransactionStatus.REVERSED,
            description: `Withdrawal rejection refund: ${diamondAmount} diamonds`,
          },
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      },
    );

    this.logger.log(
      `Withdrawal refund: ${diamondAmount} diamonds to user ${userId}`,
    );
  }

  /**
   * Award daily bonus coins.
   */
  async awardDailyBonus(
    userId: string,
    amount: number = 10,
  ): Promise<TransactionResult> {
    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({ where: { userId } });

      if (!wallet) {
        throw new NotFoundException('Wallet not found');
      }

      await tx.wallet.update({
        where: { userId },
        data: { giftCoins: { increment: amount } },
      });

      const transaction = await tx.transaction.create({
        data: {
          type: TransactionType.DAILY_BONUS,
          receiverId: userId,
          coinAmount: amount,
          status: TransactionStatus.COMPLETED,
          description: 'Daily free coin reward',
        },
      });

      return {
        transactionId: transaction.id,
        status: transaction.status,
        coinAmount: amount,
        diamondAmount: 0,
      };
    });
  }

  /**
   * Award referral bonus.
   */
  async awardReferralBonus(
    userId: string,
    amount: number,
    description: string,
  ): Promise<TransactionResult> {
    return this.prisma.$transaction(async (tx) => {
      await this.ensureWalletInTx(tx, userId);

      await tx.wallet.update({
        where: { userId },
        data: { giftCoins: { increment: amount } },
      });

      const transaction = await tx.transaction.create({
        data: {
          type: TransactionType.REFERRAL_REWARD,
          receiverId: userId,
          coinAmount: amount,
          status: TransactionStatus.COMPLETED,
          description,
        },
      });

      return {
        transactionId: transaction.id,
        status: transaction.status,
        coinAmount: amount,
        diamondAmount: 0,
      };
    });
  }

  /**
   * Get transaction history with pagination.
   */
  async getTransactionHistory(userId: string, page?: number, limit?: number) {
    const params = getPaginationParams(page, limit);

    const where = {
      OR: [{ senderId: userId }, { receiverId: userId }],
    };

    const [transactions, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return buildPaginatedResult(transactions, total, params);
  }

  private async ensureWalletInTx(tx: any, userId: string) {
    let wallet = await tx.wallet.findUnique({ where: { userId } });

    if (!wallet) {
      wallet = await tx.wallet.create({ data: { userId } });
    }

    return wallet;
  }
}
