import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto, CreateProductDto, ProductQueryDto, UpdateCategoryDto, UpdateProductDto } from './catalog.dto';
import { RecipeDto, RecipesService } from './recipes.service';

@Controller()
export class CatalogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recipes: RecipesService,
  ) {}

  @Get('product-categories')
  categories(@Query() query: HotelQueryDto, @CurrentUser() user: JwtPayload) {
    return this.prisma.productCategory.findMany({
      where: { hotelId: resolveHotelScope(user, query.hotelId) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('product-categories')
  async createCategory(@Body() { hotelId, ...data }: CreateCategoryDto, @CurrentUser() user: JwtPayload) {
    const scoped = this.requireHotel(user, hotelId);
    await this.assertPrinter(scoped, data.printerId);
    return this.prisma.productCategory.create({ data: { ...data, hotelId: scoped } });
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch('product-categories/:id')
  async updateCategory(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCategoryDto, @CurrentUser() user: JwtPayload) {
    const category = await this.prisma.productCategory.findUnique({ where: { id } });
    if (!category || !canAccessHotel(user, category.hotelId)) {
      throw new NotFoundException('Categoria nao encontrada');
    }
    await this.assertPrinter(category.hotelId, dto.printerId);
    return this.prisma.productCategory.update({ where: { id }, data: dto });
  }

  @Get('products')
  products(@Query() query: ProductQueryDto, @CurrentUser() user: JwtPayload) {
    const q = query.q?.trim();
    return this.prisma.product.findMany({
      where: {
        hotelId: resolveHotelScope(user, query.hotelId),
        categoryId: query.categoryId,
        sellable: query.sellable,
        ...(query.outlet ? { OR: [{ category: { outlet: query.outlet } }, { category: { outlet: null } }, { categoryId: null }] } : {}),
        ...(q ? { AND: [{ OR: [{ name: { contains: q } }, { sku: { contains: q } }] }] } : {}),
      },
      include: { category: { select: { id: true, name: true, outlet: true } } },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('products')
  async createProduct(@Body() { hotelId, ...data }: CreateProductDto, @CurrentUser() user: JwtPayload) {
    const scoped = this.requireHotel(user, hotelId);
    await this.assertRefs(scoped, data);
    return this.prisma.product.create({ data: { ...data, hotelId: scoped } });
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch('products/:id')
  async updateProduct(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProductDto, @CurrentUser() user: JwtPayload) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || !canAccessHotel(user, product.hotelId)) {
      throw new NotFoundException('Produto nao encontrado');
    }
    await this.assertRefs(product.hotelId, dto);
    if (dto.trackStock && (await this.prisma.recipeItem.count({ where: { productId: id } }))) {
      throw new BadRequestException('Este produto tem receita: o stock e controlado pelos ingredientes');
    }
    if (dto.trackStock === false && (await this.prisma.recipeItem.count({ where: { ingredientId: id } }))) {
      throw new BadRequestException('Este produto e ingrediente de uma receita e tem de controlar stock');
    }
    return this.prisma.product.update({ where: { id }, data: dto });
  }

  @Get('products/:id/recipe')
  recipe(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.recipes.get(id, user);
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Put('products/:id/recipe')
  setRecipe(@Param('id', ParseIntPipe) id: number, @Body() dto: RecipeDto, @CurrentUser() user: JwtPayload) {
    return this.recipes.set(id, dto, user);
  }

  private async assertPrinter(hotelId: number, printerId?: number | null) {
    if (!printerId) return;
    const printer = await this.prisma.printer.findUnique({ where: { id: printerId } });
    if (printer?.hotelId !== hotelId) {
      throw new BadRequestException('Impressora invalida para este hotel');
    }
  }

  private requireHotel(user: JwtPayload, hotelId?: number) {
    const scoped = resolveHotelScope(user, hotelId);
    if (!scoped) {
      throw new BadRequestException('hotelId e obrigatorio');
    }
    return scoped;
  }

  private async assertRefs(hotelId: number, data: { categoryId?: number | null; taxRateId?: number | null }) {
    if (data.categoryId) {
      const category = await this.prisma.productCategory.findUnique({ where: { id: data.categoryId } });
      if (category?.hotelId !== hotelId) {
        throw new BadRequestException('Categoria invalida para este hotel');
      }
    }
    if (data.taxRateId) {
      const rate = await this.prisma.taxRate.findUnique({ where: { id: data.taxRateId } });
      if (rate?.hotelId !== hotelId) {
        throw new BadRequestException('Taxa de IVA invalida para este hotel');
      }
    }
  }
}
