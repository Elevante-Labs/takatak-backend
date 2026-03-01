import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FollowService } from './follow.service';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';

@Controller('users')
@UseGuards(AuthGuard('jwt'))
export class FollowController {
  constructor(private readonly followService: FollowService) {}

  /** Follow a user */
  @Post(':id/follow')
  async follow(
    @CurrentUser() user: JwtPayload,
    @Param('id') targetId: string,
  ) {
    return this.followService.follow(user.sub, targetId);
  }

  /** Unfollow a user */
  @Delete(':id/follow')
  async unfollow(
    @CurrentUser() user: JwtPayload,
    @Param('id') targetId: string,
  ) {
    return this.followService.unfollow(user.sub, targetId);
  }

  /** Get followers of a user */
  @Get(':id/followers')
  async getFollowers(
    @Param('id') userId: string,
    @Query() query: PaginationDto,
  ) {
    return this.followService.getFollowers(userId, query.page, query.limit);
  }

  /** Get who a user is following */
  @Get(':id/following')
  async getFollowing(
    @Param('id') userId: string,
    @Query() query: PaginationDto,
  ) {
    return this.followService.getFollowing(userId, query.page, query.limit);
  }

  /** Check if current user follows target */
  @Get(':id/follow/status')
  async isFollowing(
    @CurrentUser() user: JwtPayload,
    @Param('id') targetId: string,
  ) {
    const following = await this.followService.isFollowing(user.sub, targetId);
    return { isFollowing: following };
  }
}
