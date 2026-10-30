import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { JwtPayload } from '../auth/jwt-payload';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { HotelQueryDto } from '../common/hotel-query.dto';
import { canAccessHotel, resolveHotelScope } from '../common/hotel-scope';
import { PrismaService } from '../prisma/prisma.service';
import { UploadsService } from '../uploads/uploads';
import { CreateCategoryDto, CreateProductDto, ImageSearchQueryDto, ProductImageDto, ProductQueryDto, UpdateCategoryDto, UpdateProductDto } from './catalog.dto';

import { ImageSearchService } from './image-search';
import { RecipeDto, RecipesService } from './recipes.service';

@Controller()
export class CatalogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recipes: RecipesService,
    private readonly uploads: UploadsService,
    private readonly images: ImageSearchService,
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
  @Get('products/image-search')
  imageSearch(@Query() query: ImageSearchQueryDto) {
    return this.images.search(query.q.trim());
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('products/:id/image')
  async setImage(@Param('id', ParseIntPipe) id: number, @Body() dto: ProductImageDto, @CurrentUser() user: JwtPayload) {
    const product = await this.findProduct(id, user);
    if (!dto.data === !dto.url) {
      throw new BadRequestException('Envia a imagem ou o endereco da imagem');
    }
    const imageFile = dto.data ? await this.uploads.saveImage(dto.data) : await this.uploads.saveRemote(dto.url!);
    const updated = await this.prisma.product.update({ where: { id }, data: { imageFile }, include: { category: { select: { id: true, name: true, outlet: true } } } });
    await this.uploads.remove(product.imageFile);
    return updated;
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete('products/:id/image')
  async removeImage(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    const product = await this.findProduct(id, user);
    const updated = await this.prisma.product.update({ where: { id }, data: { imageFile: null }, include: { category: { select: { id: true, name: true, outlet: true } } } });
    await this.uploads.remove(product.imageFile);
    return updated;
  }

  @Get('products/next-sku')
  async nextSkuPreview(@Query() query: HotelQueryDto, @CurrentUser() user: JwtPayload) {
    return { sku: await this.nextSku(this.requireHotel(user, query.hotelId)) };
  }

  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post('products')
  async createProduct(@Body() { hotelId, ...data }: CreateProductDto, @CurrentUser() user: JwtPayload) {
    const scoped = this.requireHotel(user, hotelId);
    await this.assertRefs(scoped, data);
    const sku = data.sku?.trim();
    if (sku) {
      return this.prisma.product.create({ data: { ...data, sku, hotelId: scoped } });
    }
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.product.create({ data: { ...data, sku: await this.nextSku(scoped), hotelId: scoped } });
      } catch (error) {
        if (attempt >= 4 || !(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      }
    }
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

  private async findProduct(id: number, user: JwtPayload) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || !canAccessHotel(user, product.hotelId)) {
      throw new NotFoundException('Produto nao encontrado');
    }
    return product;
  }

  private async nextSku(hotelId: number) {
    const products = await this.prisma.product.findMany({ where: { hotelId, sku: { not: null } }, select: { sku: true } });
    const highest = products.reduce((max, product) => (/^\d+$/.test(product.sku ?? '') ? Math.max(max, Number(product.sku)) : max), 0);
    return String(highest + 1).padStart(2, '0');
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
