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
import { ChatService } from './chat.service';
import { CreateChatDto } from './dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';

@Controller('chat')
@UseGuards(AuthGuard('jwt'))
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  async createChat(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateChatDto,
  ) {
    return this.chatService.createOrGetChat(user.sub, dto.targetId);
  }

  @Get()
  async getUserChats(
    @CurrentUser() user: JwtPayload,
    @Query() query: PaginationDto,
  ) {
    return this.chatService.getUserChats(user.sub, query.page, query.limit);
  }

  @Get(':chatId/messages')
  async getChatMessages(
    @CurrentUser() user: JwtPayload,
    @Param('chatId', ParseUUIDPipe) chatId: string,
    @Query() query: PaginationDto,
  ) {
    return this.chatService.getChatMessages(
      user.sub,
      chatId,
      query.page,
      query.limit,
    );
  }

  @Get('intimacy/:hostId')
  async getIntimacy(
    @CurrentUser() user: JwtPayload,
    @Param('hostId', ParseUUIDPipe) hostId: string,
  ) {
    return this.chatService.getIntimacyInfo(user.sub, hostId);
  }
}
