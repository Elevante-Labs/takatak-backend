import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface GiftMetrics {
  totalGiftsSent: number;
  totalDiamondsGenerated: number;
  uniqueGifterUsers: number;
  uniqueReceiverUsers: number;
  averageGiftValue: number;
  topGifts: Array<{
    name: string;
    sent: number;
    diamondsGenerated: number;
  }>;
  topGifters: Array<{
    userId: string;
    sent: number;
  }>;
  topReceivers: Array<{
    userId: string;
    diamondsReceived: number;
  }>;
}

export interface GiftTimeSeriesMetrics {
  date: string;
  totalGiftsSent: number;
  totalDiamondsGenerated: number;
  uniqueGifters: number;
}

@Injectable()
export class GiftAnalyticsService {
  private readonly logger = new Logger(GiftAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get overall gift metrics
   */
  async getMetrics(): Promise<GiftMetrics> {
    // Total gifts and diamonds
    const totalStats = await this.prisma.giftTransaction.aggregate({
      _count: { id: true },
      _sum: { diamondValue: true },
    });

    // Unique gifters and receivers
    const uniqueUsers = await this.prisma.giftTransaction.groupBy({
      by: ['senderId', 'receiverId'],
    });

    const uniqueSenderIds = new Set<string>();
    const uniqueReceiverIds = new Set<string>();

    uniqueUsers.forEach((record) => {
      uniqueSenderIds.add(record.senderId);
      uniqueReceiverIds.add(record.receiverId);
    });

    // Top gifts by analytics
    const topGiftsData = await this.prisma.giftAnalytics.findMany({
      orderBy: { totalSent: 'desc' },
      take: 10,
      include: { gift: { select: { name: true } } },
    });

    // Top gifters
    const topGiftersData = await this.prisma.giftTransaction.groupBy({
      by: ['senderId'],
      _count: true,
      orderBy: { _count: { senderId: 'desc' } },
      take: 10,
    });

    // Top receivers
    const topReceiversData = await this.prisma.giftTransaction.groupBy({
      by: ['receiverId'],
      _sum: { diamondValue: true },
      orderBy: { _sum: { diamondValue: 'desc' } },
      take: 10,
    });

    return {
      totalGiftsSent: totalStats._count.id,
      totalDiamondsGenerated: totalStats._sum.diamondValue ?? 0,
      uniqueGifterUsers: uniqueSenderIds.size,
      uniqueReceiverUsers: uniqueReceiverIds.size,
      averageGiftValue:
        totalStats._count.id > 0
          ? Math.round((totalStats._sum.diamondValue ?? 0) / totalStats._count.id)
          : 0,
      topGifts: topGiftsData.map((a) => ({
        name: a.gift.name,
        sent: a.totalSent,
        diamondsGenerated: a.totalDiamondsEarned,
      })),
      topGifters: topGiftersData.map((record) => ({
        userId: record.senderId,
        sent: record._count,
      })),
      topReceivers: topReceiversData.map((record) => ({
        userId: record.receiverId,
        diamondsReceived: record._sum.diamondValue ?? 0,
      })),
    };
  }

  /**
   * Get gift metrics by date range
   */
  async getMetricsByDateRange(
    startDate: Date,
    endDate: Date,
  ): Promise<GiftTimeSeriesMetrics[]> {
    const transactions = await this.prisma.giftTransaction.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        createdAt: true,
        diamondValue: true,
        senderId: true,
      },
    });

    // Group by date
    const byDate = new Map<string, GiftTimeSeriesMetrics>();

    transactions.forEach((tx) => {
      const date = tx.createdAt.toISOString().split('T')[0];
      if (!byDate.has(date)) {
        byDate.set(date, {
          date,
          totalGiftsSent: 0,
          totalDiamondsGenerated: 0,
          uniqueGifters: 0,
        });
      }

      const metrics = byDate.get(date)!;
      metrics.totalGiftsSent++;
      metrics.totalDiamondsGenerated += tx.diamondValue;
    });

    // Count unique gifters per day
    transactions.forEach((tx) => {
      const date = tx.createdAt.toISOString().split('T')[0];
      const metrics = byDate.get(date)!;
      const giftersSet = new Set<string>();
      transactions
        .filter((t) => t.createdAt.toISOString().split('T')[0] === date)
        .forEach((t) => giftersSet.add(t.senderId));
      metrics.uniqueGifters = giftersSet.size;
    });

    return Array.from(byDate.values()).sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
  }

  /**
   * Get gifter statistics
   */
  async getGifterStats(userId: string) {
    const stats = await this.prisma.giftTransaction.aggregate({
      where: { senderId: userId },
      _count: true,
      _sum: { coinCost: true },
    });

    const byGift = await this.prisma.giftTransaction.groupBy({
      by: ['giftId'],
      where: { senderId: userId },
      _count: true,
      orderBy: { _count: { giftId: 'desc' } },
      take: 10,
    });

    return {
      totalGiftsSent: stats._count,
      totalCoinSpent: stats._sum.coinCost ?? 0,
      favoriteGifts: byGift,
    };
  }

  /**
   * Get receiver statistics
   */
  async getReceiverStats(userId: string) {
    const stats = await this.prisma.giftTransaction.aggregate({
      where: { receiverId: userId },
      _count: true,
      _sum: { diamondValue: true },
    });

    const byGift = await this.prisma.giftTransaction.groupBy({
      by: ['giftId'],
      where: { receiverId: userId },
      _sum: { diamondValue: true },
      orderBy: { _sum: { diamondValue: 'desc' } },
      take: 10,
    });

    return {
      totalGiftsReceived: stats._count,
      totalDiamondsReceived: stats._sum.diamondValue ?? 0,
      mostPopularGifts: byGift,
    };
  }

  /**
   * Get top gifters leaderboard
   */
  async getTopGiftersLeaderboard(limit: number = 100) {
    const topGifters = await this.prisma.giftTransaction.groupBy({
      by: ['senderId'],
      _count: true,
      _sum: { coinCost: true },
      orderBy: [
        { _count: { senderId: 'desc' } },
        { _sum: { coinCost: 'desc' } },
      ],
      take: limit,
    });

    return topGifters.map((record, index) => ({
      rank: index + 1,
      userId: record.senderId,
      totalGiftsSent: record._count,
      totalCoinSpent: record._sum.coinCost ?? 0,
    }));
  }

  /**
   * Get top earning hosts leaderboard
   */
  async getTopEarningHostsLeaderboard(limit: number = 100) {
    const topEarners = await this.prisma.giftTransaction.groupBy({
      by: ['receiverId'],
      _count: true,
      _sum: { diamondValue: true },
      orderBy: { _sum: { diamondValue: 'desc' } },
      take: limit,
    });

    return topEarners.map((record, index) => ({
      rank: index + 1,
      hostUserId: record.receiverId,
      totalGiftsReceived: record._count,
      totalDiamondsEarned: record._sum.diamondValue ?? 0,
    }));
  }

  /**
   * Get gift popularity trends (calculated from analytics)
   */
  async getGiftPopularityTrends(limit: number = 20) {
    const gifts = await this.prisma.giftAnalytics.findMany({
      orderBy: { popularityScore: 'desc' },
      take: limit,
      include: { gift: { select: { id: true, name: true, rarity: true } } },
    });

    return gifts.map((a) => ({
      gift: a.gift,
      totalSent: a.totalSent,
      popularityScore: a.popularityScore,
      lastSentAt: a.lastSentAt,
    }));
  }

  /**
   * Calculate daily popularity scores for all gifts
   * This should be run once daily (via a cron job)
   */
  async calculateDailyPopularityScores(): Promise<void> {
    const gifts = await this.prisma.gift.findMany({
      select: { id: true },
    });

    for (const gift of gifts) {
      // Count gifts sent in last 24 hours
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const giftsSentToday = await this.prisma.giftTransaction.count({
        where: {
          giftId: gift.id,
          createdAt: { gte: oneDayAgo },
        },
      });

      // Update popularity score
      await this.prisma.giftAnalytics.update({
        where: { giftId: gift.id },
        data: {
          popularityScore: giftsSentToday,
        },
      });
    }

    this.logger.log('Daily popularity scores calculated');
  }
}
