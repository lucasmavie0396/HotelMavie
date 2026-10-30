import { Controller, Get, Query } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { Public } from '../common/decorators/public.decorator';
import { domainVariants, isValidDomain, normalizeDomain } from '../hotels/domains';
import { PrismaService } from '../prisma/prisma.service';

class DomainQueryDto {
  @IsString()
  @MaxLength(253)
  host: string;
}

@Public()
@Controller('public/domain')
export class PublicDomainController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async resolve(@Query() query: DomainQueryDto) {
    const host = normalizeDomain(query.host);
    if (!host || !isValidDomain(host)) return { slug: null };
    const hotel = await this.prisma.hotel.findFirst({
      where: { customDomain: { in: domainVariants(host) }, publicEnabled: true, publicSlug: { not: null } },
      select: { publicSlug: true },
    });
    return { slug: hotel?.publicSlug ?? null };
  }
}
