import { Test, TestingModule } from '@nestjs/testing';
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    NotFoundException,
} from '@nestjs/common';
import { AgencyService } from './agency.service';
import { PrismaService } from '../../database/prisma.service';

/**
 * Agency Service Unit Tests
 *
 * Covers:
 * 1. Duplicate commission attempt (idempotency)
 * 2. Commission cascade (parent-child)
 * 3. Refund scenario (reversal)
 * 4. Double reversal idempotency
 * 5. Reversal with insufficient balance
 * 6. Host removed (no agency) → no commission
 * 7. Banned agency → skip commission
 * 8. Join/leave flow
 */

// Mock Prisma transaction client
const createMockTx = () => ({
    hostProfile: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
    },
    agency: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
    },
    agencyCommissionLog: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
    },
    wallet: {
        findUnique: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
    },
    transaction: {
        create: jest.fn(),
    },
    $queryRaw: jest.fn(),
});

const createMockPrisma = () => ({
    agency: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
    },
    user: {
        findUnique: jest.fn(),
        update: jest.fn(),
    },
    hostProfile: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
    },
    wallet: {
        findUnique: jest.fn(),
    },
    transaction: {
        aggregate: jest.fn(),
    },
    agencyCommissionLog: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        aggregate: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
    },
    $transaction: jest.fn(),
});

describe('AgencyService', () => {
    let service: AgencyService;
    let mockPrisma: ReturnType<typeof createMockPrisma>;

    beforeEach(async () => {
        mockPrisma = createMockPrisma();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AgencyService,
                { provide: PrismaService, useValue: mockPrisma },
            ],
        }).compile();

        service = module.get<AgencyService>(AgencyService);
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    // ──────────────────────────────────────────
    // 1. Duplicate Commission (Idempotency)
    // ──────────────────────────────────────────

    describe('processGiftCommission - idempotency', () => {
        it('should skip if commission log already exists for the transaction', async () => {
            const tx = createMockTx();
            const originalTxId = 'tx-uuid-1';

            // Host has an agency
            tx.hostProfile.findUnique.mockResolvedValue({
                userId: 'host-1',
                agencyId: 'agency-1',
                agency: { id: 'agency-1', ownerId: 'owner-1', isBanned: false },
            });

            // Agency exists
            tx.agency.findUnique.mockResolvedValue({
                id: 'agency-1',
                ownerId: 'owner-1',
                isBanned: false,
                parentAgencyId: null,
                level: 'D',
                rollingDiamonds30d: 100,
                owner: { id: 'owner-1' },
            });

            // Commission log ALREADY exists (idempotency guard)
            tx.agencyCommissionLog.findUnique.mockResolvedValue({
                id: 'log-1',
                agencyId: 'agency-1',
                originalTransactionId: originalTxId,
                isReversal: false,
            });

            const result = await service.processGiftCommission(
                'host-1',
                1000,
                originalTxId,
                tx as any,
            );

            // Should NOT create any new records
            expect(tx.wallet.update).not.toHaveBeenCalled();
            expect(tx.transaction.create).not.toHaveBeenCalled();
            expect(tx.agencyCommissionLog.create).not.toHaveBeenCalled();
            expect(result.tierChanges).toEqual([]);
        });

        it('should process commission on first call', async () => {
            const tx = createMockTx();
            const originalTxId = 'tx-uuid-new';

            tx.hostProfile.findUnique.mockResolvedValue({
                userId: 'host-1',
                agencyId: 'agency-1',
                agency: { id: 'agency-1', ownerId: 'owner-1', isBanned: false },
            });

            tx.agency.findUnique.mockResolvedValue({
                id: 'agency-1',
                ownerId: 'owner-1',
                isBanned: false,
                parentAgencyId: null,
                level: 'D',
                rollingDiamonds30d: 500000,
                owner: { id: 'owner-1' },
            });

            // No existing commission log
            tx.agencyCommissionLog.findUnique.mockResolvedValue(null);

            // Wallet exists
            tx.$queryRaw.mockResolvedValue([{ id: 'w-1', userId: 'owner-1', diamonds: 1000 }]);

            // Tier stays the same after update
            tx.agency.update.mockResolvedValue({
                id: 'agency-1',
                rollingDiamonds30d: 501000,
                level: 'D',
            });

            const result = await service.processGiftCommission(
                'host-1',
                1000,
                originalTxId,
                tx as any,
            );

            // Should credit wallet
            expect(tx.wallet.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { userId: 'owner-1' },
                    data: { diamonds: { increment: expect.any(Number) } },
                }),
            );

            // Should create transaction record
            expect(tx.transaction.create).toHaveBeenCalled();

            // Should create commission log with originalTransactionId
            expect(tx.agencyCommissionLog.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        originalTransactionId: originalTxId,
                        isReversal: false,
                    }),
                }),
            );
        });
    });

    // ──────────────────────────────────────────
    // 2. Commission Cascade (Parent-Child)
    // ──────────────────────────────────────────

    describe('processGiftCommission - cascade', () => {
        it('should credit both sub-agency and parent agency', async () => {
            const tx = createMockTx();
            const originalTxId = 'tx-cascade';

            // Host belongs to sub-agency
            tx.hostProfile.findUnique.mockResolvedValue({
                userId: 'host-1',
                agencyId: 'sub-agency-1',
                agency: { id: 'sub-agency-1', ownerId: 'sub-owner', isBanned: false },
            });

            // First call: sub-agency
            // Second call: parent agency
            tx.agency.findUnique
                .mockResolvedValueOnce({
                    id: 'sub-agency-1',
                    ownerId: 'sub-owner',
                    isBanned: false,
                    parentAgencyId: 'parent-agency-1',
                    level: 'D',
                    rollingDiamonds30d: 200000,
                    owner: { id: 'sub-owner' },
                })
                .mockResolvedValueOnce({
                    id: 'parent-agency-1',
                    ownerId: 'parent-owner',
                    isBanned: false,
                    parentAgencyId: null,
                    level: 'C',
                    rollingDiamonds30d: 2000000,
                    owner: { id: 'parent-owner' },
                })
                // Child agency lookup for rate comparison
                .mockResolvedValueOnce({
                    id: 'sub-agency-1',
                    rollingDiamonds30d: 200000,
                });

            // No existing logs
            tx.agencyCommissionLog.findUnique.mockResolvedValue(null);

            // Wallets exist
            tx.$queryRaw.mockResolvedValue([{ id: 'w-1', userId: 'some-owner', diamonds: 5000 }]);

            // Agency updates
            tx.agency.update
                .mockResolvedValueOnce({ id: 'sub-agency-1', rollingDiamonds30d: 201000, level: 'D' })
                .mockResolvedValueOnce({ id: 'parent-agency-1', rollingDiamonds30d: 2001000, level: 'C' });

            await service.processGiftCommission('host-1', 1000, originalTxId, tx as any);

            // Should create 2 commission logs (sub + parent)
            expect(tx.agencyCommissionLog.create).toHaveBeenCalledTimes(2);

            // Should credit 2 wallets
            expect(tx.wallet.update).toHaveBeenCalledTimes(2);
        });
    });

    // ──────────────────────────────────────────
    // 3. Refund Scenario (Reversal)
    // ──────────────────────────────────────────

    describe('reverseChatPaymentCommission', () => {
        it('should reverse all commission logs and deduct diamonds', async () => {
            const commissionLogs = [
                {
                    id: 'log-1',
                    agencyId: 'agency-1',
                    originalTransactionId: 'tx-1',
                    diamondsEarned: 40,
                    giftDiamonds: 1000,
                    commissionRate: 0.04,
                    subAgencyRate: 0,
                    effectiveRate: 0.04,
                    sourceAgencyId: null,
                    hostId: 'host-1',
                    isReversal: false,
                },
            ];

            const mockTx = createMockTx();

            // Find original commission logs
            mockTx.agencyCommissionLog.findMany.mockResolvedValue(commissionLogs);

            // No existing reversal
            mockTx.agencyCommissionLog.findUnique.mockResolvedValue(null);

            // Agency exists
            mockTx.agency.findUnique.mockResolvedValue({
                id: 'agency-1',
                ownerId: 'owner-1',
                rollingDiamonds30d: 1000,
            });

            // Wallet has sufficient diamonds
            mockTx.$queryRaw.mockResolvedValue([
                { id: 'w-1', userId: 'owner-1', diamonds: 500 },
            ]);

            mockPrisma.$transaction.mockImplementation(async (fn: any) => {
                return fn(mockTx);
            });

            await service.reverseChatPaymentCommission('tx-1');

            // Should deduct diamonds
            expect(mockTx.wallet.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: { diamonds: { decrement: 40 } },
                }),
            );

            // Should create reversal transaction
            expect(mockTx.transaction.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        type: 'AGENCY_COMMISSION_REVERSAL',
                    }),
                }),
            );

            // Should create reversal log
            expect(mockTx.agencyCommissionLog.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        isReversal: true,
                        diamondsEarned: -40,
                    }),
                }),
            );
        });
    });

    // ──────────────────────────────────────────
    // 4. Double Reversal Idempotency
    // ──────────────────────────────────────────

    describe('reverseChatPaymentCommission - double reversal', () => {
        it('should skip if reversal log already exists', async () => {
            const commissionLogs = [
                {
                    id: 'log-1',
                    agencyId: 'agency-1',
                    originalTransactionId: 'tx-1',
                    diamondsEarned: 40,
                    giftDiamonds: 1000,
                    isReversal: false,
                },
            ];

            const mockTx = createMockTx();

            mockTx.agencyCommissionLog.findMany.mockResolvedValue(commissionLogs);

            // Reversal already exists!
            mockTx.agencyCommissionLog.findUnique.mockResolvedValue({
                id: 'reversal-log-1',
                isReversal: true,
            });

            mockPrisma.$transaction.mockImplementation(async (fn: any) => {
                return fn(mockTx);
            });

            await service.reverseChatPaymentCommission('tx-1');

            // Should NOT deduct any diamonds
            expect(mockTx.wallet.update).not.toHaveBeenCalled();
            expect(mockTx.transaction.create).not.toHaveBeenCalled();
        });
    });

    // ──────────────────────────────────────────
    // 5. Reversal with Insufficient Balance
    // ──────────────────────────────────────────

    describe('reverseChatPaymentCommission - insufficient balance', () => {
        it('should throw if agency owner has insufficient diamonds', async () => {
            const commissionLogs = [
                {
                    id: 'log-1',
                    agencyId: 'agency-1',
                    originalTransactionId: 'tx-1',
                    diamondsEarned: 500,
                    isReversal: false,
                },
            ];

            const mockTx = createMockTx();

            mockTx.agencyCommissionLog.findMany.mockResolvedValue(commissionLogs);
            mockTx.agencyCommissionLog.findUnique.mockResolvedValue(null);

            mockTx.agency.findUnique.mockResolvedValue({
                id: 'agency-1',
                ownerId: 'owner-1',
                rollingDiamonds30d: 1000,
            });

            // Owner only has 100 diamonds, needs 500
            mockTx.$queryRaw.mockResolvedValue([
                { id: 'w-1', userId: 'owner-1', diamonds: 100 },
            ]);

            mockPrisma.$transaction.mockImplementation(async (fn: any) => {
                return fn(mockTx);
            });

            await expect(
                service.reverseChatPaymentCommission('tx-1'),
            ).rejects.toThrow(BadRequestException);
        });
    });

    // ──────────────────────────────────────────
    // 6. Host Removed (No Agency)
    // ──────────────────────────────────────────

    describe('processGiftCommission - host without agency', () => {
        it('should skip if host has no agency', async () => {
            const tx = createMockTx();

            tx.hostProfile.findUnique.mockResolvedValue({
                userId: 'host-1',
                agencyId: null, // No agency
                agency: null,
            });

            const result = await service.processGiftCommission(
                'host-1',
                1000,
                'tx-uuid',
                tx as any,
            );

            expect(tx.wallet.update).not.toHaveBeenCalled();
            expect(result.tierChanges).toEqual([]);
        });

        it('should skip if host profile not found', async () => {
            const tx = createMockTx();

            tx.hostProfile.findUnique.mockResolvedValue(null);

            const result = await service.processGiftCommission(
                'nonexistent-host',
                1000,
                'tx-uuid',
                tx as any,
            );

            expect(tx.wallet.update).not.toHaveBeenCalled();
            expect(result.tierChanges).toEqual([]);
        });
    });

    // ──────────────────────────────────────────
    // 7. Banned Agency
    // ──────────────────────────────────────────

    describe('processGiftCommission - banned agency', () => {
        it('should skip commission for banned agency', async () => {
            const tx = createMockTx();

            tx.hostProfile.findUnique.mockResolvedValue({
                userId: 'host-1',
                agencyId: 'agency-banned',
                agency: { id: 'agency-banned', ownerId: 'owner-1', isBanned: true },
            });

            tx.agency.findUnique.mockResolvedValue({
                id: 'agency-banned',
                ownerId: 'owner-1',
                isBanned: true,
                parentAgencyId: null,
            });

            const result = await service.processGiftCommission(
                'host-1',
                1000,
                'tx-uuid',
                tx as any,
            );

            expect(tx.wallet.update).not.toHaveBeenCalled();
            expect(result.tierChanges).toEqual([]);
        });
    });

    // ──────────────────────────────────────────
    // 8. Join/Leave Flow
    // ──────────────────────────────────────────

    describe('joinAgency', () => {
        it('should allow a host to join an agency', async () => {
            mockPrisma.user.findUnique.mockResolvedValue({
                id: 'host-1',
                role: 'HOST',
                hostProfile: { id: 'hp-1', agencyId: null, isBanned: false },
            });

            mockPrisma.agency.findUnique.mockResolvedValue({
                id: 'agency-1',
                ownerId: 'owner-1',
                isBanned: false,
            });

            mockPrisma.hostProfile.update.mockResolvedValue({});

            const result = await service.joinAgency('host-1', 'agency-1');

            expect(result.success).toBe(true);
            expect(mockPrisma.hostProfile.update).toHaveBeenCalled();
        });

        it('should reject if host is already in an agency', async () => {
            mockPrisma.user.findUnique.mockResolvedValue({
                id: 'host-1',
                role: 'HOST',
                hostProfile: { id: 'hp-1', agencyId: 'other-agency', isBanned: false },
            });

            await expect(
                service.joinAgency('host-1', 'agency-1'),
            ).rejects.toThrow(ConflictException);
        });

        it('should reject if host is banned', async () => {
            mockPrisma.user.findUnique.mockResolvedValue({
                id: 'host-1',
                role: 'HOST',
                hostProfile: { id: 'hp-1', agencyId: null, isBanned: true },
            });

            await expect(
                service.joinAgency('host-1', 'agency-1'),
            ).rejects.toThrow(ForbiddenException);
        });

        it('should reject non-HOST users', async () => {
            mockPrisma.user.findUnique.mockResolvedValue({
                id: 'user-1',
                role: 'USER',
                hostProfile: null,
            });

            await expect(
                service.joinAgency('user-1', 'agency-1'),
            ).rejects.toThrow(ForbiddenException);
        });
    });

    describe('leaveAgency', () => {
        it('should allow a host to leave their agency', async () => {
            mockPrisma.hostProfile.findUnique.mockResolvedValue({
                id: 'hp-1',
                userId: 'host-1',
                agencyId: 'agency-1',
                agency: { ownerId: 'owner-1' },
            });

            mockPrisma.hostProfile.update.mockResolvedValue({});

            const result = await service.leaveAgency('host-1');

            expect(result.success).toBe(true);
        });

        it('should reject if host is not in any agency', async () => {
            mockPrisma.hostProfile.findUnique.mockResolvedValue({
                id: 'hp-1',
                userId: 'host-1',
                agencyId: null,
            });

            await expect(
                service.leaveAgency('host-1'),
            ).rejects.toThrow(BadRequestException);
        });
    });

    // ──────────────────────────────────────────
    // Zero gift diamonds edge case
    // ──────────────────────────────────────────

    describe('processGiftCommission - zero diamonds', () => {
        it('should skip if giftDiamonds is zero', async () => {
            const tx = createMockTx();

            const result = await service.processGiftCommission(
                'host-1',
                0,
                'tx-uuid',
                tx as any,
            );

            expect(tx.hostProfile.findUnique).not.toHaveBeenCalled();
            expect(result.tierChanges).toEqual([]);
        });
    });
});
