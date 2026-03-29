import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class HostDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Aggregate dashboard stats for a host.
   */
  async getDashboard(userId: string) {
    // Verify the user is a HOST
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, isVerified: true },
    });

    if (!user || user.role !== 'HOST') {
      throw new ForbiddenException('Only hosts can access the dashboard');
    }

    // Fetch wallet balance
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { diamonds: true, promoDiamonds: true, giftCoins: true, gameCoins: true },
    });

    // Get conversion ratio
    const ratioSetting = await this.prisma.systemSettings.findUnique({
      where: { key: 'DIAMOND_TO_COIN_RATIO' },
    });
    const conversionRatio = ratioSetting
      ? parseInt(ratioSetting.value, 10)
      : 10;

    // Today's start (UTC)
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    // Total diamonds earned (sum of CHAT_PAYMENT transactions where host is receiver)
    const totalDiamondsResult = await this.prisma.transaction.aggregate({
      where: {
        receiverId: userId,
        type: 'CHAT_PAYMENT',
        status: 'COMPLETED',
      },
      _sum: { diamondAmount: true },
    });
    const totalDiamondsEarned = totalDiamondsResult._sum?.diamondAmount || 0;

    // Today's diamonds
    const todayDiamondsResult = await this.prisma.transaction.aggregate({
      where: {
        receiverId: userId,
        type: 'CHAT_PAYMENT',
        status: 'COMPLETED',
        createdAt: { gte: todayStart },
      },
      _sum: { diamondAmount: true },
    });
    const todayDiamonds = todayDiamondsResult._sum?.diamondAmount || 0;

    // Total messages received (count of messages where host is receiver)
    const totalMessagesReceived = await this.prisma.message.count({
      where: {
        chat: {
          OR: [{ user1Id: userId }, { user2Id: userId }],
        },
        senderId: { not: userId },
      },
    });

    // Active chats count (chats that have messages in last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const activeChats = await this.prisma.chat.count({
      where: {
        OR: [{ user1Id: userId }, { user2Id: userId }],
        messages: {
          some: { createdAt: { gte: oneDayAgo } },
        },
      },
    });

    // Pending withdrawal amount
    const pendingWithdrawals = await this.prisma.withdrawalRequest.aggregate({
      where: {
        userId,
        status: 'PENDING',
      },
      _sum: { diamondAmount: true },
    });
    const withdrawalPendingAmount =
      pendingWithdrawals._sum.diamondAmount || 0;

    // Follower count
    const followerCount = await this.prisma.follow.count({
      where: { followeeId: userId },
    });

    return {
      isVerified: user.isVerified,
      balance: {
        diamonds: wallet?.diamonds || 0,
        promoDiamonds: wallet?.promoDiamonds || 0,
        giftCoins: wallet?.giftCoins || 0,
        gameCoins: wallet?.gameCoins || 0,
      },
      conversionRatio,
      todayDiamonds,
      totalDiamondsEarned,
      totalMessagesReceived,
      activeChatsCount: activeChats,
      withdrawalPendingAmount,
      followerCount,
    };
  }
}
