/**
 * Wallet Concurrency Stress Test
 *
 * Tests the critical race condition: two concurrent message sends
 * from the same user draining the same wallet.
 *
 * Run against a real database:
 *   DATABASE_URL=... npx jest test/stress/wallet-concurrency.test.ts --runInBand
 */
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma.service';
import { WalletService } from '../../src/modules/wallet/wallet.service';
import { CoinType } from '../../src/modules/wallet/dto/recharge.dto';

describe('Wallet Concurrency Stress Test', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let walletService: WalletService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    walletService = app.get(WalletService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should prevent double-spend when two payments fire concurrently', async () => {
    // Setup: Create sender with exactly 15 coins, and a receiver
    const sender = await prisma.user.create({
      data: {
        phone: `+1${Date.now()}0001`,
        isVerified: true,
        role: 'USER',
        wallet: { create: { gameCoins: 15 } },
      },
    });
    const receiver = await prisma.user.create({
      data: {
        phone: `+1${Date.now()}0002`,
        isVerified: true,
        role: 'HOST',
        wallet: { create: {} },
      },
    });

    // Fire two concurrent payments each costing 10 coins.
    // With 15 coins, only ONE should succeed.
    const results = await Promise.allSettled([
      walletService.processChatPayment({
        senderId: sender.id,
        receiverId: receiver.id,
        coinCost: 10,
        diamondGenerated: 10,
      }),
      walletService.processChatPayment({
        senderId: sender.id,
        receiverId: receiver.id,
        coinCost: 10,
        diamondGenerated: 10,
      }),
    ]);

    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected');

    // Exactly one should succeed, one should fail
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    // Verify final balance is exactly 5, not -5
    const finalWallet = await prisma.wallet.findUnique({
      where: { userId: sender.id },
    });
    expect(finalWallet!.gameCoins).toBe(5);
    expect(finalWallet!.gameCoins).toBeGreaterThanOrEqual(0);

    // Verify receiver got exactly 10 diamonds, not 20
    const receiverWallet = await prisma.wallet.findUnique({
      where: { userId: receiver.id },
    });
    expect(receiverWallet!.diamonds).toBe(10);

    // Cleanup
    await prisma.transaction.deleteMany({
      where: { OR: [{ senderId: sender.id }, { receiverId: receiver.id }] },
    });
    await prisma.wallet.deleteMany({
      where: { userId: { in: [sender.id, receiver.id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [sender.id, receiver.id] } },
    });
  });

  it('should handle 10 concurrent payments correctly', async () => {
    const sender = await prisma.user.create({
      data: {
        phone: `+1${Date.now()}0003`,
        isVerified: true,
        role: 'USER',
        wallet: { create: { gameCoins: 100 } },
      },
    });
    const receiver = await prisma.user.create({
      data: {
        phone: `+1${Date.now()}0004`,
        isVerified: true,
        role: 'HOST',
        wallet: { create: {} },
      },
    });

    // 10 concurrent payments of 15 coins each from a 100-coin wallet
    // At most 6 should succeed (6*15 = 90 <= 100, 7*15 = 105 > 100)
    const payments = Array.from({ length: 10 }, () =>
      walletService.processChatPayment({
        senderId: sender.id,
        receiverId: receiver.id,
        coinCost: 15,
        diamondGenerated: 15,
      }),
    );

    const results = await Promise.allSettled(payments);
    const successes = results.filter((r) => r.status === 'fulfilled');

    // Verify wallet never went negative
    const finalWallet = await prisma.wallet.findUnique({
      where: { userId: sender.id },
    });
    expect(finalWallet!.gameCoins).toBeGreaterThanOrEqual(0);

    // Verify total deducted = successes * 15
    const totalDeducted = successes.length * 15;
    expect(finalWallet!.gameCoins).toBe(100 - totalDeducted);

    // Verify diamonds match
    const receiverWallet = await prisma.wallet.findUnique({
      where: { userId: receiver.id },
    });
    expect(receiverWallet!.diamonds).toBe(successes.length * 15);

    // Cleanup
    await prisma.transaction.deleteMany({
      where: { OR: [{ senderId: sender.id }, { receiverId: receiver.id }] },
    });
    await prisma.wallet.deleteMany({
      where: { userId: { in: [sender.id, receiver.id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [sender.id, receiver.id] } },
    });
  });

  it('should never allow negative balance even under serialization failures', async () => {
    const sender = await prisma.user.create({
      data: {
        phone: `+1${Date.now()}0005`,
        isVerified: true,
        role: 'USER',
        wallet: { create: { gameCoins: 10 } },
      },
    });
    const receiver = await prisma.user.create({
      data: {
        phone: `+1${Date.now()}0006`,
        isVerified: true,
        role: 'HOST',
        wallet: { create: {} },
      },
    });

    // 5 concurrent payments each costing exactly 10 coins
    // Only 1 should succeed
    const payments = Array.from({ length: 5 }, () =>
      walletService.processChatPayment({
        senderId: sender.id,
        receiverId: receiver.id,
        coinCost: 10,
        diamondGenerated: 10,
      }),
    );

    const results = await Promise.allSettled(payments);
    const successes = results.filter((r) => r.status === 'fulfilled');

    expect(successes.length).toBe(1);

    const finalWallet = await prisma.wallet.findUnique({
      where: { userId: sender.id },
    });
    expect(finalWallet!.gameCoins).toBe(0);

    // Cleanup
    await prisma.transaction.deleteMany({
      where: { OR: [{ senderId: sender.id }, { receiverId: receiver.id }] },
    });
    await prisma.wallet.deleteMany({
      where: { userId: { in: [sender.id, receiver.id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [sender.id, receiver.id] } },
    });
  });
});
