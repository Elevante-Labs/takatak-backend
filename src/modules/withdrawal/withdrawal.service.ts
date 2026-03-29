import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { WithdrawalStatus } from '@prisma/client';
import {
  getPaginationParams,
  buildPaginatedResult,
} from '../../common/utils/pagination.util';

@Injectable()
export class WithdrawalService {
  private readonly logger = new Logger(WithdrawalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
  ) {}

  /**
   * Create a withdrawal request.
   * Diamonds are deducted immediately (locked) and refunded if rejected.
   */
  async createWithdrawalRequest(
    userId: string,
    diamondAmount: number,
  ) {
    if (diamondAmount <= 0) {
      throw new BadRequestException('Diamond amount must be positive');
    }

    // Check minimum withdrawal amount from SystemSettings
    const minSetting = await this.prisma.systemSettings.findUnique({
      where: { key: 'MIN_WITHDRAWAL_DIAMONDS' },
    });
    const minWithdrawal = minSetting ? parseInt(minSetting.value, 10) : 100;

    if (diamondAmount < minWithdrawal) {
      throw new BadRequestException(
        `Minimum withdrawal is ${minWithdrawal} diamonds`,
      );
    }

    // Check user role (only HOSTs can withdraw)
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (!user || user.role !== 'HOST') {
      throw new ForbiddenException('Only hosts can withdraw diamonds');
    }

    // Deduct diamonds atomically (locks them)
    const idempotencyKey = `withdrawal:${userId}:${Date.now()}`;
    await this.walletService.deductDiamondsForWithdrawal(
      userId,
      diamondAmount,
      idempotencyKey,
    );

    // Create the withdrawal request record
    const request = await this.prisma.withdrawalRequest.create({
      data: {
        userId,
        diamondAmount,
        status: WithdrawalStatus.PENDING,
      },
    });

    this.logger.log(
      `Withdrawal request created: ${request.id} for ${diamondAmount} diamonds by user ${userId}`,
    );

    return request;
  }

  /**
   * Get withdrawal requests for a user.
   */
  async getUserWithdrawals(
    userId: string,
    page?: number,
    limit?: number,
  ) {
    const params = getPaginationParams(page, limit);

    const where = { userId };

    const [requests, total] = await Promise.all([
      this.prisma.withdrawalRequest.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.withdrawalRequest.count({ where }),
    ]);

    return buildPaginatedResult(requests, total, params);
  }

  /**
   * Admin: Get all withdrawal requests with optional status filter.
   */
  async getWithdrawalRequests(
    page?: number,
    limit?: number,
    status?: string,
  ) {
    const params = getPaginationParams(page, limit);

    const where = status
      ? { status: status as WithdrawalStatus }
      : {};

    const [requests, total] = await Promise.all([
      this.prisma.withdrawalRequest.findMany({
        where,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              phone: true,
              username: true,
              role: true,
            },
          },
        },
      }),
      this.prisma.withdrawalRequest.count({ where }),
    ]);

    return buildPaginatedResult(requests, total, params);
  }

  /**
   * Admin: Approve a withdrawal request.
   */
  async approveWithdrawal(requestId: string, adminId: string) {
    const request = await this.prisma.withdrawalRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Withdrawal request not found');
    }

    if (request.status !== WithdrawalStatus.PENDING) {
      throw new BadRequestException(
        `Cannot approve a ${request.status} withdrawal`,
      );
    }

    const updated = await this.prisma.withdrawalRequest.update({
      where: { id: requestId },
      data: {
        status: WithdrawalStatus.APPROVED,
        processedAt: new Date(),
        processedBy: adminId,
      },
    });

    this.logger.log(
      `Withdrawal ${requestId} APPROVED by admin ${adminId}`,
    );

    return updated;
  }

  /**
   * Admin: Reject a withdrawal request.
   * Refunds the diamonds atomically back to the user's wallet.
   */
  async rejectWithdrawal(
    requestId: string,
    adminId: string,
    adminNote?: string,
  ) {
    const request = await this.prisma.withdrawalRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Withdrawal request not found');
    }

    if (request.status !== WithdrawalStatus.PENDING) {
      throw new BadRequestException(
        `Cannot reject a ${request.status} withdrawal`,
      );
    }

    // Refund diamonds atomically
    await this.walletService.refundWithdrawalDiamonds(
      request.userId,
      request.diamondAmount,
    );

    const updated = await this.prisma.withdrawalRequest.update({
      where: { id: requestId },
      data: {
        status: WithdrawalStatus.REJECTED,
        processedAt: new Date(),
        processedBy: adminId,
        adminNote: adminNote || 'Rejected by admin',
      },
    });

    this.logger.log(
      `Withdrawal ${requestId} REJECTED by admin ${adminId}. ${request.diamondAmount} diamonds refunded to user ${request.userId}`,
    );

    return updated;
  }
}
