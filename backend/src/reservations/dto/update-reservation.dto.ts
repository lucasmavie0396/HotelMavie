import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateReservationDto } from './create-reservation.dto';

export class UpdateReservationDto extends PartialType(OmitType(CreateReservationDto, ['guestId', 'source'] as const)) {}
