import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles, SalesAccess } from '../common/decorators/roles.decorator';
import { ImageUploadDto } from '../uploads/uploads';
import { CreateHotelDto } from './dto/create-hotel.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';
import { HotelsService } from './hotels.service';

@Controller('hotels')
export class HotelsController {
  constructor(private readonly hotelsService: HotelsService) {}

  @SalesAccess()
  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.hotelsService.findAll(user);
  }

  @Roles(UserRole.ADMIN)
  @Get(':id/domain-check')
  domainCheck(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.hotelsService.domainCheck(id, user);
  }

  @SalesAccess()
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.hotelsService.findOne(id, user);
  }

  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() dto: CreateHotelDto) {
    return this.hotelsService.create(dto);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateHotelDto) {
    return this.hotelsService.update(id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/logo')
  setLogo(@Param('id', ParseIntPipe) id: number, @Body() dto: ImageUploadDto, @CurrentUser() user: JwtPayload) {
    return this.hotelsService.setLogo(id, dto.data, user);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id/logo')
  removeLogo(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.hotelsService.setLogo(id, null, user);
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.hotelsService.remove(id);
  }
}
