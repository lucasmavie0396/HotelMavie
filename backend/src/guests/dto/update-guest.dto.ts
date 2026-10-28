import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateGuestDto } from './create-guest.dto';

export class UpdateGuestDto extends PartialType(OmitType(CreateGuestDto, ['hotelId'] as const)) {}
