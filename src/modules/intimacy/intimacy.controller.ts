import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  CurrentUser,
  JwtPayload,
} from '../../common/decorators/current-user.decorator';
import { IntimacyEngineService } from './intimacy.service';
import { RelationshipService } from './relationship.service';
import { FeatureGateService } from './feature-gate.service';
import { IntimacyGateway } from './intimacy.gateway';
import {
  TrackInteractionDto,
  SendRelationshipInviteDto,
  RespondRelationshipDto,
  ReactivateRelationshipDto,
} from './dto';
import { RelationshipResponse } from './dto/respond-relationship.dto';
import { LEVEL_THRESHOLDS } from './constants/intimacy.constants';

@Controller()
@UseGuards(AuthGuard('jwt'))
export class IntimacyController {
  constructor(
    private readonly intimacyEngine: IntimacyEngineService,
    private readonly relationshipService: RelationshipService,
    private readonly featureGate: FeatureGateService,
    private readonly gateway: IntimacyGateway,
  ) {}

  // ─────────────────────────────────────────
  //  INTIMACY ENDPOINTS
  // ─────────────────────────────────────────

  /**
   * GET /intimacy/:userId/:otherUserId
   * Get intimacy info between two users.
   */
  @Get('intimacy/:userId/:otherUserId')
  async getIntimacy(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('otherUserId', ParseUUIDPipe) otherUserId: string,
  ) {
    return this.intimacyEngine.getIntimacyInfo(userId, otherUserId);
  }

  /**
   * POST /intimacy/interact
   * Track an interaction between two users.
   */
  @Post('intimacy/interact')
  async trackInteraction(
    @CurrentUser() user: JwtPayload,
    @Body() dto: TrackInteractionDto,
  ) {
    const result = await this.intimacyEngine.trackInteraction(
      user.sub,
      dto.otherUserId,
      dto.type,
      {
        replySpeedMs: dto.replySpeedMs,
        giftCoins: dto.giftCoins,
        extra: dto.metadata,
      },
    );

    // Emit real-time events
    const info = await this.intimacyEngine.getIntimacyInfo(
      user.sub,
      dto.otherUserId,
    );

    await this.gateway.emitIntimacyUpdated(user.sub, dto.otherUserId, {
      level: info.level,
      score: info.score,
      xpEarned: result.xpEarned,
      progressPercent: info.progressPercent,
    });

    if (result.leveledUp) {
      await this.gateway.emitLevelUp(user.sub, dto.otherUserId, {
        previousLevel: result.previousLevel!,
        newLevel: result.newLevel,
        score: info.score,
      });
    }

    return {
      xpEarned: result.xpEarned,
      leveledUp: result.leveledUp,
      ...info,
    };
  }

  /**
   * GET /intimacy/levels
   * Get all level thresholds.
   */
  @Get('intimacy/levels')
  getLevels() {
    return this.intimacyEngine.getLevelThresholds();
  }

  /**
   * GET /intimacy/features/:otherUserId
   * Get all feature access for a pair.
   */
  @Get('intimacy/features/:otherUserId')
  async getFeatureAccess(
    @CurrentUser() user: JwtPayload,
    @Param('otherUserId', ParseUUIDPipe) otherUserId: string,
  ) {
    return this.featureGate.getAllFeatureAccess(user.sub, otherUserId);
  }

  // ─────────────────────────────────────────
  //  RELATIONSHIP ENDPOINTS
  // ─────────────────────────────────────────

  /**
   * POST /relationship/invite
   * Send a relationship invite.
   */
  @Post('relationship/invite')
  async sendInvite(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SendRelationshipInviteDto,
  ) {
    const relationship = await this.relationshipService.sendInvite(
      user.sub,
      dto.otherUserId,
      dto.type,
    );

    await this.gateway.emitRelationshipChange(user.sub, dto.otherUserId, {
      status: 'PENDING',
      type: dto.type,
      relationshipId: relationship.id,
    });

    return relationship;
  }

  /**
   * POST /relationship/respond
   * Accept or reject a relationship invite.
   */
  @Post('relationship/respond')
  async respondToInvite(
    @CurrentUser() user: JwtPayload,
    @Body() dto: RespondRelationshipDto,
  ) {
    let result;

    if (dto.response === RelationshipResponse.ACCEPT) {
      result = await this.relationshipService.acceptInvite(
        dto.relationshipId,
        user.sub,
      );
    } else {
      result = await this.relationshipService.rejectInvite(
        dto.relationshipId,
        user.sub,
      );
    }

    // Get the relationship to emit to both users
    const relationship = await this.relationshipService['prisma'].relationship.findUnique({
      where: { id: dto.relationshipId },
      include: { intimacy: true },
    });

    if (relationship) {
      await this.gateway.emitRelationshipChange(
        relationship.inviterId,
        relationship.inviteeId,
        {
          status: result.status,
          type: result.type,
          relationshipId: result.id,
        },
      );
    }

    return result;
  }

  /**
   * POST /relationship/reactivate
   * Reactivate an expired relationship.
   */
  @Post('relationship/reactivate')
  async reactivateRelationship(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ReactivateRelationshipDto,
  ) {
    const result = await this.relationshipService.reactivateRelationship(
      user.sub,
      dto.otherUserId,
    );

    await this.gateway.emitRelationshipChange(user.sub, dto.otherUserId, {
      status: 'ACTIVE',
      type: result.relationship.type,
      relationshipId: result.relationship.id,
    });

    return { cost: result.cost, relationship: result.relationship };
  }
}
