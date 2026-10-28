import { Controller, Get, Global, Module, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { resolveHotelScope } from '../common/hotel-scope';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from './mail.service';

@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller('email-logs')
export class EmailLogsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  @Get()
  async list(@Query() query: HotelQueryDto, @CurrentUser() user: JwtPayload) {
    const items = await this.prisma.emailLog.findMany({
      where: { hotelId: resolveHotelScope(user, query.hotelId) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { smtpConfigured: this.mail.configured, items };
  }
}

@Global()
@Module({
  controllers: [EmailLogsController],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
