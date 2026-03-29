import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { FollowService } from './follow.service';
import { PrismaService } from '../../database/prisma.service';

describe('FollowService', () => {
  let service: FollowService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
    },
    follow: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FollowService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<FollowService>(FollowService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('follow', () => {
    it('should reject self-follow', async () => {
      await expect(service.follow('u-1', 'u-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject follow if target not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.follow('u-1', 'u-2')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should reject duplicate follow', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'u-2' });
      mockPrismaService.follow.findUnique.mockResolvedValue({
        followerId: 'u-1',
        followeeId: 'u-2',
      });

      await expect(service.follow('u-1', 'u-2')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should create follow relationship', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'u-2' });
      mockPrismaService.follow.findUnique.mockResolvedValue(null);
      mockPrismaService.follow.create.mockResolvedValue({
        followerId: 'u-1',
        followeeId: 'u-2',
      });

      const result = await service.follow('u-1', 'u-2');

      expect(result.followerId).toBe('u-1');
      expect(result.followeeId).toBe('u-2');
    });
  });

  describe('unfollow', () => {
    it('should reject self-unfollow', async () => {
      await expect(service.unfollow('u-1', 'u-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw if not following', async () => {
      mockPrismaService.follow.findUnique.mockResolvedValue(null);

      await expect(service.unfollow('u-1', 'u-2')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should unfollow successfully', async () => {
      mockPrismaService.follow.findUnique.mockResolvedValue({
        followerId: 'u-1',
        followeeId: 'u-2',
      });
      mockPrismaService.follow.delete.mockResolvedValue({});

      const result = await service.unfollow('u-1', 'u-2');

      expect(result.success).toBe(true);
    });
  });

  describe('isFollowing', () => {
    it('should return true when following', async () => {
      mockPrismaService.follow.findUnique.mockResolvedValue({
        followerId: 'u-1',
        followeeId: 'u-2',
      });

      const result = await service.isFollowing('u-1', 'u-2');
      expect(result).toBe(true);
    });

    it('should return false when not following', async () => {
      mockPrismaService.follow.findUnique.mockResolvedValue(null);

      const result = await service.isFollowing('u-1', 'u-2');
      expect(result).toBe(false);
    });
  });

  describe('getFollowers', () => {
    it('should return paginated follower list', async () => {
      mockPrismaService.follow.findMany.mockResolvedValue([
        { follower: { id: 'u-1', username: 'alice' } },
      ]);
      mockPrismaService.follow.count.mockResolvedValue(1);

      const result = await service.getFollowers('u-2', 1, 10);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });
  });
});
