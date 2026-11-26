import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Param, ParseIntPipe, Put } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, Length, Max, Min, ValidateNested } from 'class-validator';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles, SalesAccess } from '../common/decorators/roles.decorator';
import { canAccessHotel } from '../common/hotel-scope';
import { toMoney } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';

class OptionDto {
  @IsOptional()
  @IsInt()
  id?: number;

  @IsString()
  @Length(1, 60)
  name: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-1_000_000)
  @Max(1_000_000)
  priceDelta?: number;

  @IsOptional()
  @IsInt()
  ingredientId?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  quantity?: number;
}

class GroupDto {
  @IsOptional()
  @IsInt()
  id?: number;

  @IsString()
  @Length(1, 60)
  name: string;

  @IsBoolean()
  required: boolean;

  @IsInt()
  @Min(1)
  @Max(20)
  maxChoices: number;

  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => OptionDto)
  options: OptionDto[];
}

export class ProductOptionsDto {
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => GroupDto)
  groups: GroupDto[];
}

export const activeOptionGroups = {
  where: { active: true },
  orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  select: {
    id: true,
    name: true,
    required: true,
    maxChoices: true,
    options: {
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, priceDelta: true, ingredientId: true, quantity: true, ingredient: { select: { id: true, name: true, unit: true } } },
    },
  },
} satisfies Prisma.Product$optionGroupsArgs;

export interface ChosenOption {
  optionId: number;
  groupId: number;
  groupName: string;
  name: string;
  priceDelta: Prisma.Decimal;
  ingredientId: number | null;
  quantity: Prisma.Decimal;
}

export async function resolveOptions(client: Prisma.TransactionClient | PrismaService, productId: number, optionIds: number[] = []): Promise<ChosenOption[]> {
  const groups = await client.productOptionGroup.findMany({ where: { productId, active: true }, include: { options: { where: { active: true } } } });
  const ids = [...new Set(optionIds)];
  if (ids.length !== optionIds.length) throw new BadRequestException('Escolha cada opcao uma so vez');
  const chosen: ChosenOption[] = [];
  for (const id of ids) {
    const group = groups.find((entry) => entry.options.some((option) => option.id === id));
    if (!group) throw new BadRequestException('Opcao invalida para este produto');
    const option = group.options.find((entry) => entry.id === id)!;
    chosen.push({ optionId: option.id, groupId: group.id, groupName: group.name, name: option.name, priceDelta: option.priceDelta, ingredientId: option.ingredientId, quantity: option.quantity });
  }
  for (const group of groups.filter((entry) => entry.options.length)) {
    const count = chosen.filter((option) => option.groupId === group.id).length;
    if (group.required && count < 1) throw new BadRequestException(`Escolha ${group.name.toLowerCase()}`);
    if (count > group.maxChoices) throw new BadRequestException(`Em ${group.name} escolha no maximo ${group.maxChoices}`);
  }
  return chosen;
}

@Injectable()
export class ProductOptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(productId: number, user: JwtPayload) {
    const product = await this.product(productId, user);
    return this.prisma.productOptionGroup.findMany({ ...activeOptionGroups, where: { productId: product.id, active: true } });
  }

  async set(productId: number, dto: ProductOptionsDto, user: JwtPayload) {
    const product = await this.product(productId, user);
    const ingredientIds = [...new Set(dto.groups.flatMap((group) => group.options.map((option) => option.ingredientId)).filter((id): id is number => Boolean(id)))];
    if (ingredientIds.length) {
      const ingredients = await this.prisma.product.findMany({ where: { id: { in: ingredientIds }, hotelId: product.hotelId, trackStock: true } });
      if (ingredients.length !== ingredientIds.length) throw new BadRequestException('Os ingredientes das opcoes tem de ser produtos deste hotel que controlam stock');
    }
    for (const group of dto.groups) {
      if (!group.options.length) throw new BadRequestException(`O grupo ${group.name} nao tem opcoes`);
      for (const option of group.options) {
        if (option.ingredientId && !(option.quantity && option.quantity > 0)) throw new BadRequestException(`Indique a quantidade de ingrediente da opcao ${option.name}`);
      }
    }
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.productOptionGroup.findMany({ where: { productId }, include: { options: true } });
      const keptGroups = new Set<number>();
      for (const [groupIndex, group] of dto.groups.entries()) {
        const current = group.id ? existing.find((entry) => entry.id === group.id) : null;
        if (group.id && !current) throw new BadRequestException('Grupo de opcoes invalido');
        const data = { name: group.name.trim(), required: group.required, maxChoices: group.maxChoices, sortOrder: groupIndex, active: true };
        const saved = current ? await tx.productOptionGroup.update({ where: { id: current.id }, data }) : await tx.productOptionGroup.create({ data: { ...data, productId } });
        keptGroups.add(saved.id);
        const keptOptions = new Set<number>();
        for (const [optionIndex, option] of group.options.entries()) {
          const currentOption = option.id ? current?.options.find((entry) => entry.id === option.id) : null;
          if (option.id && !currentOption) throw new BadRequestException('Opcao invalida');
          const optionData = {
            name: option.name.trim(),
            priceDelta: toMoney(option.priceDelta ?? 0),
            ingredientId: option.ingredientId || null,
            quantity: option.ingredientId ? (option.quantity ?? 0) : 0,
            sortOrder: optionIndex,
            active: true,
          };
          const savedOption = currentOption
            ? await tx.productOption.update({ where: { id: currentOption.id }, data: optionData })
            : await tx.productOption.create({ data: { ...optionData, groupId: saved.id } });
          keptOptions.add(savedOption.id);
        }
        await tx.productOption.updateMany({ where: { groupId: saved.id, id: { notIn: [...keptOptions] } }, data: { active: false } });
      }
      await tx.productOptionGroup.updateMany({ where: { productId, id: { notIn: [...keptGroups] } }, data: { active: false } });
    });
    return this.get(productId, user);
  }

  private async product(id: number, user: JwtPayload) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || !canAccessHotel(user, product.hotelId)) throw new NotFoundException('Produto nao encontrado');
    return product;
  }
}

@Controller('products')
export class ProductOptionsController {
  constructor(private readonly options: ProductOptionsService) {}

  @SalesAccess()
  @Get(':id/options')
  get(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.options.get(id, user);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Put(':id/options')
  set(@Param('id', ParseIntPipe) id: number, @Body() dto: ProductOptionsDto, @CurrentUser() user: JwtPayload) {
    return this.options.set(id, dto, user);
  }
}
