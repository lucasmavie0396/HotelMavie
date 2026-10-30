import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Module, Param, ParseIntPipe, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { ReportsModule } from '../reports/reports.module';
import { ClockDto, CopyWeekDto, EmployeeDto, MonthQueryDto, RangeQueryDto, ShiftDto, UpdateEmployeeDto, UpdateShiftDto, UpdateTimeEntryDto } from './hr.dto';
import { HrService } from './hr.service';
import { CreateRunDto, PayrollService, PayrollSettingsDto, RunQueryDto, UpdatePayslipDto } from './payroll.service';

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

@Roles(...MANAGERS)
@Controller('hr/payroll')
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get('settings')
  settings(@Query() query: HotelQueryDto, @CurrentUser() user: JwtPayload) {
    return this.payroll.settings(query, user);
  }

  @Put('settings')
  saveSettings(@Body() dto: PayrollSettingsDto, @CurrentUser() user: JwtPayload) {
    return this.payroll.saveSettings(dto, user);
  }

  @Get('runs')
  runs(@Query() query: RunQueryDto, @CurrentUser() user: JwtPayload) {
    return this.payroll.runs(query, user);
  }

  @Post('runs')
  createRun(@Body() dto: CreateRunDto, @CurrentUser() user: JwtPayload) {
    return this.payroll.createRun(dto, user);
  }

  @Get('runs/:id')
  findRun(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.payroll.findRun(id, user);
  }

  @Post('runs/:id/recalculate')
  @HttpCode(HttpStatus.OK)
  recalculate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.payroll.recalculate(id, user);
  }

  @Post('runs/:id/close')
  @HttpCode(HttpStatus.OK)
  close(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.payroll.close(id, user);
  }

  @Delete('runs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.payroll.remove(id, user);
  }

  @Get('runs/:id/pdf')
  async summaryPdf(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload, @Res() res: Response) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="mapa-salarios-${id}.pdf"`);
    res.send(await this.payroll.summaryPdf(id, user));
  }

  @Patch('payslips/:id')
  updatePayslip(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePayslipDto, @CurrentUser() user: JwtPayload) {
    return this.payroll.updatePayslip(id, dto, user);
  }

  @Get('payslips/:id/pdf')
  async payslipPdf(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload, @Res() res: Response) {
    const { buffer, name } = await this.payroll.payslipPdf(id, user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${name}.pdf"`);
    res.send(buffer);
  }
}

@Module({
  imports: [ReportsModule],
  controllers: [HrController, PayrollController],
  providers: [HrService, PayrollService],
})
export class HrModule {}
