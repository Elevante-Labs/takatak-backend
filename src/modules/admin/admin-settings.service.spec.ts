import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminSettingsService } from './admin-settings.service';
import { PrismaService } from '../../database/prisma.service';

describe('AdminSettingsService', () => {
  let service: AdminSettingsService;

  const mockPrismaService = {
    systemSettings: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminSettingsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<AdminSettingsService>(AdminSettingsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAll', () => {
    it('should return all settings', async () => {
      const settings = [
        { key: 'DIAMOND_TO_COIN_RATIO', value: '10' },
        { key: 'MESSAGE_MAX_LENGTH', value: '300' },
      ];
      mockPrismaService.systemSettings.findMany.mockResolvedValue(settings);

      const result = await service.getAll();
      expect(result).toHaveLength(2);
    });
  });

  describe('getByKey', () => {
    it('should return a setting by key', async () => {
      mockPrismaService.systemSettings.findUnique.mockResolvedValue({
        key: 'DIAMOND_TO_COIN_RATIO',
        value: '10',
      });

      const result = await service.getByKey('DIAMOND_TO_COIN_RATIO');
      expect(result.value).toBe('10');
    });

    it('should throw NotFoundException for unknown key', async () => {
      mockPrismaService.systemSettings.findUnique.mockResolvedValue(null);

      await expect(service.getByKey('UNKNOWN_KEY')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateSetting', () => {
    it('should reject disallowed key', async () => {
      await expect(
        service.updateSetting('INVALID_KEY', '5', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject non-positive number values', async () => {
      await expect(
        service.updateSetting('DIAMOND_TO_COIN_RATIO', '0', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject negative number values', async () => {
      await expect(
        service.updateSetting('DIAMOND_TO_COIN_RATIO', '-5', 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should upsert valid setting', async () => {
      mockPrismaService.systemSettings.upsert.mockResolvedValue({
        key: 'DIAMOND_TO_COIN_RATIO',
        value: '15',
        updatedBy: 'admin-1',
      });

      const result = await service.updateSetting(
        'DIAMOND_TO_COIN_RATIO',
        '15',
        'admin-1',
      );

      expect(result.value).toBe('15');
      expect(mockPrismaService.systemSettings.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'DIAMOND_TO_COIN_RATIO' },
        }),
      );
    });
  });
});
