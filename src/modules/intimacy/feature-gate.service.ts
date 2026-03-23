import { Injectable, ForbiddenException } from '@nestjs/common';
import { IntimacyEngineService } from './intimacy.service';
import { FEATURE_LEVEL_MAP } from './constants/intimacy.constants';

@Injectable()
export class FeatureGateService {
  constructor(private readonly intimacyEngine: IntimacyEngineService) {}

  /**
   * Check if a pair of users has access to a specific feature
   * based on their intimacy level.
   *
   * Returns { allowed, currentLevel, requiredLevel }
   */
  async checkFeatureAccess(
    userA: string,
    userB: string,
    feature: string,
  ): Promise<{ allowed: boolean; currentLevel: number; requiredLevel: number }> {
    const requiredLevel = FEATURE_LEVEL_MAP[feature];

    if (requiredLevel === undefined) {
      // Unknown feature — allow by default (no gating)
      return { allowed: true, currentLevel: 0, requiredLevel: 0 };
    }

    const intimacy = await this.intimacyEngine.getIntimacy(userA, userB);
    const currentLevel = intimacy?.level ?? 0;

    return {
      allowed: currentLevel >= requiredLevel,
      currentLevel,
      requiredLevel,
    };
  }

  /**
   * Enforce feature access — throws ForbiddenException if not allowed.
   */
  async enforceFeatureAccess(
    userA: string,
    userB: string,
    feature: string,
  ): Promise<void> {
    const { allowed, currentLevel, requiredLevel } =
      await this.checkFeatureAccess(userA, userB, feature);

    if (!allowed) {
      throw new ForbiddenException(
        `Feature "${feature}" requires intimacy level ${requiredLevel}. Current level: ${currentLevel}`,
      );
    }
  }

  /**
   * Get all features and their access status for a pair.
   */
  async getAllFeatureAccess(userA: string, userB: string) {
    const intimacy = await this.intimacyEngine.getIntimacy(userA, userB);
    const currentLevel = intimacy?.level ?? 0;

    const features: Record<
      string,
      { allowed: boolean; requiredLevel: number }
    > = {};

    for (const [feature, requiredLevel] of Object.entries(FEATURE_LEVEL_MAP)) {
      features[feature] = {
        allowed: currentLevel >= requiredLevel,
        requiredLevel,
      };
    }

    return { currentLevel, features };
  }
}
