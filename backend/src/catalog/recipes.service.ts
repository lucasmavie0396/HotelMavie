import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsInt, IsNumber, Min, ValidateNested } from 'class-validator';
import { JwtPayload } from '../auth/jwt-payload';
import { canAccessHotel } from '../common/hotel-scope';
import { toMoney } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';

export class RecipeLineDto {
  @IsInt()
  ingredientId: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  quantity: number;
}

export class RecipeDto {
  @IsArray()
  @ArrayUnique((line: RecipeLineDto) => line.ingredientId)
  @ValidateNested({ each: true })
  @Type(() => RecipeLineDto)
  items: RecipeLineDto[];
}

@Injectable()
export class RecipesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(productId: number, user: JwtPayload) {
    const product = await this.findProduct(productId, user);
    const items = await this.prisma.recipeItem.findMany({
      where: { productId },
      include: { ingredient: { select: { id: true, name: true, unit: true, cost: true } } },
      orderBy: { ingredient: { name: 'asc' } },
    });
    const cost = items.reduce((sum, item) => sum.add(item.quantity.mul(item.ingredient.cost)), new Prisma.Decimal(0));
    const rate = product.taxRate?.rate ?? new Prisma.Decimal(0);
    const netPrice = product.price.div(rate.div(100).add(1));
    const margin = netPrice.sub(cost);
    return {
      productId,
      items: items.map((item) => ({ ...item, lineCost: toMoney(item.quantity.mul(item.ingredient.cost)) })),
      cost: toMoney(cost),
      netPrice: toMoney(netPrice),
      margin: toMoney(margin),
      marginPercent: netPrice.isZero() ? 0 : Number(margin.div(netPrice).mul(100).toFixed(1)),
    };
  }

  async set(productId: number, dto: RecipeDto, user: JwtPayload) {
    const product = await this.findProduct(productId, user);
    if (dto.items.length && product.trackStock) {
      throw new BadRequestException('Um produto com receita nao pode controlar stock proprio: o stock e dos ingredientes');
    }
    const ingredients = await this.prisma.product.findMany({
      where: { id: { in: dto.items.map((item) => item.ingredientId) } },
      include: { _count: { select: { recipeItems: true } } },
    });
    for (const line of dto.items) {
      const ingredient = ingredients.find((item) => item.id === line.ingredientId);
      if (!ingredient || ingredient.hotelId !== product.hotelId) {
        throw new BadRequestException('Ingrediente invalido para este hotel');
      }
      if (ingredient.id === product.id) {
        throw new BadRequestException('Um produto nao pode ser ingrediente de si proprio');
      }
      if (!ingredient.trackStock) {
        throw new BadRequestException(`O ingrediente ${ingredient.name} tem de controlar stock`);
      }
      if (ingredient._count.recipeItems) {
        throw new BadRequestException(`O ingrediente ${ingredient.name} tambem tem receita; usa so ingredientes simples`);
      }
    }
    await this.prisma.$transaction([
      this.prisma.recipeItem.deleteMany({ where: { productId } }),
      this.prisma.recipeItem.createMany({
        data: dto.items.map((line) => ({ productId, ingredientId: line.ingredientId, quantity: line.quantity })),
      }),
    ]);
    return this.get(productId, user);
  }

  private async findProduct(id: number, user: JwtPayload) {
    const product = await this.prisma.product.findUnique({ where: { id }, include: { taxRate: true } });
    if (!product || !canAccessHotel(user, product.hotelId)) {
      throw new NotFoundException('Produto nao encontrado');
    }
    return product;
  }
}
