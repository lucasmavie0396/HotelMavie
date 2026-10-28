import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Module, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { ClockDto, CopyWeekDto, EmployeeDto, MonthQueryDto, RangeQueryDto, ShiftDto, UpdateEmployeeDto, UpdateShiftDto, UpdateTimeEntryDto } from './hr.dto';
import { HrService } from './hr.service';

const MANAGERS = [UserRole.ADMIN, UserRole.MANAGER];

@Controller('hr')
export class HrController {
  constructor(private readonly hr: HrService) {}

  @Get('employees')
  employees(@Query() query: HotelQueryDto, @CurrentUser() user: JwtPayload) {
    return this.hr.employees(query, user);
  }

  @Roles(...MANAGERS)
  @Post('employees')
  createEmployee(@Body() dto: EmployeeDto, @CurrentUser() user: JwtPayload) {
    return this.hr.createEmployee(dto, user);
  }

  @Roles(...MANAGERS)
  @Patch('employees/:id')
  updateEmployee(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateEmployeeDto, @CurrentUser() user: JwtPayload) {
    return this.hr.updateEmployee(id, dto, user);
  }

  @Get('shifts')
  shifts(@Query() query: RangeQueryDto, @CurrentUser() user: JwtPayload) {
    return this.hr.shifts(query, user);
  }

  @Roles(...MANAGERS)
  @Post('shifts')
  createShift(@Body() dto: ShiftDto, @CurrentUser() user: JwtPayload) {
    return this.hr.createShift(dto, user);
  }

  @Roles(...MANAGERS)
  @Post('shifts/copy-week')
  copyWeek(@Body() dto: CopyWeekDto, @CurrentUser() user: JwtPayload) {
    return this.hr.copyWeek(dto, user);
  }

  @Roles(...MANAGERS)
  @Patch('shifts/:id')
  updateShift(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateShiftDto, @CurrentUser() user: JwtPayload) {
    return this.hr.updateShift(id, dto, user);
  }

  @Roles(...MANAGERS)
  @Delete('shifts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeShift(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.hr.removeShift(id, user);
  }

  @Get('clock')
  myStatus(@CurrentUser() user: JwtPayload) {
    return this.hr.myStatus(user);
  }

  @Post('clock')
  @HttpCode(HttpStatus.OK)
  clock(@Body() dto: ClockDto, @CurrentUser() user: JwtPayload) {
    return this.hr.clock(dto, user);
  }

  @Get('time-entries')
  timeEntries(@Query() query: RangeQueryDto, @CurrentUser() user: JwtPayload) {
    return this.hr.timeEntries(query, user);
  }

  @Roles(...MANAGERS)
  @Patch('time-entries/:id')
  updateTimeEntry(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTimeEntryDto, @CurrentUser() user: JwtPayload) {
    return this.hr.updateTimeEntry(id, dto, user);
  }

  @Roles(...MANAGERS)
  @Get('monthly')
  monthly(@Query() query: MonthQueryDto, @CurrentUser() user: JwtPayload) {
    return this.hr.monthly(query, user);
  }
}

@Module({
  controllers: [HrController],
  providers: [HrService],
})
export class HrModule {}
