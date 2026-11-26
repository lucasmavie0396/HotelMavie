import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';
import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import ExcelJS from 'exceljs';
import { AuditService } from '../audit/audit';
import { JwtPayload } from '../auth/jwt-payload';
import { resolveHotelScope } from '../common/hotel-scope';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';

export class ProductImportDto {
  @IsOptional()
  @IsInt()
  hotelId?: number;

  @IsString()
  @MaxLength(11_000_000)
  file: string;
}

const SHEET = 'Produtos';
const MAX_ROWS = 2000;
const C = {
  sku: 'Codigo',
  name: 'Nome',
  category: 'Categoria',
  unit: 'Unidade',
  price: 'Preco de venda',
  cost: 'Custo',
  tax: 'IVA (%)',
  sellable: 'Vende-se no POS',
  roomService: 'Disponivel no quarto',
  trackStock: 'Controla stock',
  minStock: 'Stock minimo',
  initialStock: 'Stock inicial',
  warehouse: 'Armazem',
  active: 'Ativo',
} as const;
const COLUMNS = Object.values(C);
const REQUIRED = [C.name, C.price];

export interface ImportRow {
  line: number;
  sku: string;
  name: string;
  category: string;
  action: 'CREATE' | 'UPDATE';
  errors: string[];
}

interface ParsedRow extends ImportRow {
  data: {
    unit: string;
    price: number;
    cost: number | null;
    taxRateId: number | null;
    sellable: boolean | null;
    roomService: boolean | null;
    trackStock: boolean | null;
    minStock: number | null;
    initialStock: number | null;
    warehouseId: number | null;
    active: boolean | null;
  };
  existingId: number | null;
}

function text(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((part) => part.text).join('').trim();
    if ('result' in value) return text(value.result as ExcelJS.CellValue);
    if ('text' in value) return String(value.text).trim();
    if (value instanceof Date) return value.toISOString().slice(0, 10);
  }
  return String(value).trim();
}

function number(raw: string, label: string, errors: string[], options: { required?: boolean; max?: number } = {}) {
  if (!raw) {
    if (options.required) errors.push(`Indique ${label.toLowerCase()}`);
    return null;
  }
  const normalized = raw.replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    errors.push(`${label} invalido: ${raw}`);
    return null;
  }
  const value = Number(normalized);
  if (value < 0 || value > (options.max ?? 99_999_999)) {
    errors.push(`${label} fora dos limites: ${raw}`);
    return null;
  }
  return value;
}

function yesNo(raw: string, label: string, errors: string[]) {
  const value = raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  if (!value) return null;
  if (['SIM', 'S', 'YES', 'Y', '1', 'TRUE'].includes(value)) return true;
  if (['NAO', 'N', 'NO', '0', 'FALSE'].includes(value)) return false;
  errors.push(`${label}: escreva Sim ou Nao (${raw})`);
  return null;
}

const key = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

@Injectable()
export class ProductsExcelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
  ) {}

  async exportProducts(hotelIdParam: number | undefined, user: JwtPayload) {
    const hotelId = this.hotel(user, hotelIdParam);
    const products = await this.prisma.product.findMany({
      where: { hotelId },
      include: { category: { select: { name: true } }, taxRate: { select: { rate: true } }, stockLevels: { select: { quantity: true } } },
      orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
    });
    const workbook = this.workbook();
    const sheet = this.productsSheet(workbook, [...COLUMNS.filter((column) => column !== C.initialStock && column !== C.warehouse), 'Stock atual']);
    for (const product of products) {
      sheet.addRow([
        product.sku ?? '',
        product.name,
        product.category?.name ?? '',
        product.unit,
        Number(product.price),
        Number(product.cost),
        product.taxRate ? Number(product.taxRate.rate) : '',
        product.sellable ? 'Sim' : 'Nao',
        product.roomService ? 'Sim' : 'Nao',
        product.trackStock ? 'Sim' : 'Nao',
        Number(product.minStock),
        product.active ? 'Sim' : 'Nao',
        product.trackStock ? product.stockLevels.reduce((sum, level) => sum + Number(level.quantity), 0) : '',
      ]);
    }
    await this.audit.log({ hotelId, userId: user.sub, action: 'EXPORT', entity: 'product', summary: `Exportacao de ${products.length} produto(s) para Excel` });
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async template() {
    const workbook = this.workbook();
    const sheet = this.productsSheet(workbook, COLUMNS);
    sheet.addRow(['', 'Agua 0,5 L', 'Bebidas', 'un', 50, 20, 16, 'Sim', 'Sim', 'Sim', 24, 48, '', 'Sim']);
    const help = workbook.addWorksheet('Instrucoes');
    help.columns = [{ width: 24 }, { width: 100 }];
    const lines: [string, string][] = [
      [C.sku, 'Opcional. Se ja existir um produto com este codigo, e atualizado; se vazio ou novo, o produto e criado (sem codigo, o sistema numera).'],
      [C.name, 'Obrigatorio.'],
      [C.category, 'Opcional. Se a categoria nao existir, e criada (vai para a cozinha).'],
      [C.unit, 'Opcional (un por omissao). Ex.: un, kg, l, garrafa.'],
      [C.price, 'Obrigatorio. Preco com IVA incluido. Use virgula ou ponto para as casas decimais.'],
      [C.cost, 'Opcional. Custo sem IVA.'],
      [C.tax, 'Opcional. Uma das taxas de IVA configuradas (ex.: 16). Vazio = sem taxa.'],
      [`${C.sellable} / ${C.roomService} / ${C.trackStock} / ${C.active}`, 'Sim ou Nao. Vazio: Sim nos produtos novos (Controla stock: Nao) e sem alteracao nos que ja existem.'],
      [C.minStock, 'Opcional. Quantidade minima para o alerta e as sugestoes de encomenda.'],
      [C.initialStock, 'Opcional, so para produtos novos que controlam stock. Entra no armazem indicado.'],
      [C.warehouse, 'Opcional. Nome de um armazem; vazio = armazem principal.'],
      ['Regra', 'O ficheiro e verificado inteiro antes de gravar: se houver um erro, nada e importado. Maximo de 2000 linhas.'],
    ];
    help.addRow(['Coluna', 'Como preencher']).font = { bold: true };
    for (const line of lines) help.addRow(line);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async check(dto: ProductImportDto, user: JwtPayload) {
    const hotelId = this.hotel(user, dto.hotelId);
    const { rows, newCategories } = await this.parse(hotelId, dto.file);
    return this.summary(rows, newCategories);
  }

  async apply(dto: ProductImportDto, user: JwtPayload) {
    const hotelId = this.hotel(user, dto.hotelId);
    const { rows, newCategories } = await this.parse(hotelId, dto.file);
    const summary = this.summary(rows, newCategories);
    if (summary.withErrors) {
      throw new BadRequestException(`O ficheiro tem ${summary.withErrors} linha(s) com erros: nada foi importado`);
    }
    const created: number[] = [];
    let updated = 0;
    await this.prisma.$transaction(
      async (tx) => {
        const categories = new Map((await tx.productCategory.findMany({ where: { hotelId } })).map((category) => [key(category.name), category.id]));
        for (const name of newCategories) {
          const category = await tx.productCategory.create({ data: { hotelId, name } });
          categories.set(key(name), category.id);
        }
        const skus = await tx.product.findMany({ where: { hotelId, sku: { not: null } }, select: { sku: true } });
        let next = skus.reduce((max, product) => (/^\d+$/.test(product.sku ?? '') ? Math.max(max, Number(product.sku)) : max), 0);
        const main = await tx.warehouse.findFirst({ where: { hotelId, isDefault: true, active: true } });
        for (const row of rows) {
          const categoryId = row.category ? categories.get(key(row.category))! : undefined;
          const fields = {
            name: row.name,
            unit: row.data.unit,
            price: row.data.price,
            ...(row.category ? { categoryId } : {}),
            ...(row.data.cost !== null ? { cost: row.data.cost } : {}),
            ...(row.data.taxRateId !== null ? { taxRateId: row.data.taxRateId } : {}),
            ...(row.data.sellable !== null ? { sellable: row.data.sellable } : {}),
            ...(row.data.roomService !== null ? { roomService: row.data.roomService } : {}),
            ...(row.data.trackStock !== null ? { trackStock: row.data.trackStock } : {}),
            ...(row.data.minStock !== null ? { minStock: row.data.minStock } : {}),
            ...(row.data.active !== null ? { active: row.data.active } : {}),
          };
          if (row.existingId) {
            await tx.product.update({ where: { id: row.existingId }, data: fields });
            updated++;
            continue;
          }
          const sku = row.sku || String(++next).padStart(2, '0');
          const product = await tx.product.create({ data: { ...fields, hotelId, sku } });
          created.push(product.id);
          if (row.data.initialStock && product.trackStock) {
            const warehouseId = row.data.warehouseId ?? main?.id;
            if (!warehouseId) throw new BadRequestException('Crie um armazem antes de importar stock inicial');
            await this.stock.move(tx, {
              warehouseId,
              productId: product.id,
              type: StockMovementType.ADJUSTMENT,
              quantity: new Prisma.Decimal(row.data.initialStock),
              reason: 'Stock inicial (importacao Excel)',
              createdById: user.sub,
            });
          }
        }
        await this.audit.log(
          {
            hotelId,
            userId: user.sub,
            action: 'PRODUCT_IMPORT',
            entity: 'product',
            summary: `Importacao Excel: ${created.length} produto(s) criado(s), ${updated} atualizado(s), ${newCategories.length} categoria(s) nova(s)`,
          },
          tx,
        );
      },
      { timeout: 120_000 },
    );
    return { created: created.length, updated, newCategories };
  }

  private summary(rows: ImportRow[], newCategories: string[]) {
    return {
      total: rows.length,
      withErrors: rows.filter((row) => row.errors.length).length,
      toCreate: rows.filter((row) => row.action === 'CREATE').length,
      toUpdate: rows.filter((row) => row.action === 'UPDATE').length,
      newCategories,
      rows: rows.map(({ line, sku, name, category, action, errors }) => ({ line, sku, name, category, action, errors })),
    };
  }

  private async parse(hotelId: number, file: string) {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(Buffer.from(file.replace(/^data:[^,]*,/, ''), 'base64') as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException('O ficheiro nao e um Excel (.xlsx) valido');
    }
    const sheet = workbook.getWorksheet(SHEET) ?? workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('O ficheiro nao tem folhas');
    const header = new Map<string, number>();
    sheet.getRow(1).eachCell((cell, column) => header.set(key(text(cell.value)), column));
    const missing = REQUIRED.filter((title) => !header.has(key(title)));
    if (missing.length) {
      throw new BadRequestException(`Faltam as colunas: ${missing.join(', ')}. Use o modelo de importacao`);
    }
    const [products, categories, taxRates, warehouses] = [
      await this.prisma.product.findMany({ where: { hotelId }, select: { id: true, sku: true } }),
      await this.prisma.productCategory.findMany({ where: { hotelId }, select: { name: true } }),
      await this.prisma.taxRate.findMany({ where: { hotelId, active: true }, select: { id: true, rate: true } }),
      await this.prisma.warehouse.findMany({ where: { hotelId, active: true }, select: { id: true, name: true } }),
    ];
    const bySku = new Map(products.filter((product) => product.sku).map((product) => [key(product.sku!), product.id]));
    const knownCategories = new Set(categories.map((category) => key(category.name)));
    const newCategories = new Map<string, string>();
    const seenSkus = new Set<string>();
    const rows: ParsedRow[] = [];
    const last = sheet.actualRowCount;
    for (let line = 2; line <= sheet.rowCount; line++) {
      const row = sheet.getRow(line);
      const value = (title: string) => {
        const column = header.get(key(title));
        return column ? text(row.getCell(column).value) : '';
      };
      if (COLUMNS.every((title) => !value(title))) continue;
      if (rows.length >= MAX_ROWS) {
        throw new BadRequestException(`O ficheiro tem mais de ${MAX_ROWS} produtos`);
      }
      const errors: string[] = [];
      const sku = value(C.sku);
      const name = value(C.name);
      const category = value(C.category);
      if (!name) errors.push('Indique o nome');
      if (name.length > 120) errors.push('Nome com mais de 120 caracteres');
      if (sku.length > 40) errors.push('Codigo com mais de 40 caracteres');
      if (category.length > 80) errors.push('Categoria com mais de 80 caracteres');
      if (sku) {
        if (seenSkus.has(key(sku))) errors.push(`Codigo ${sku} repetido no ficheiro`);
        seenSkus.add(key(sku));
      }
      if (category && !knownCategories.has(key(category)) && !newCategories.has(key(category))) newCategories.set(key(category), category);
      const tax = value(C.tax);
      let taxRateId: number | null = null;
      if (tax) {
        const rate = number(tax.replace('%', ''), C.tax, errors);
        if (rate !== null) {
          const found = taxRates.find((taxRate) => Number(taxRate.rate) === rate);
          if (found) taxRateId = found.id;
          else errors.push(`Nao ha uma taxa de IVA de ${rate}% configurada`);
        }
      }
      const warehouseName = value(C.warehouse);
      const warehouse = warehouseName ? warehouses.find((entry) => key(entry.name) === key(warehouseName)) : null;
      if (warehouseName && !warehouse) errors.push(`Armazem desconhecido: ${warehouseName}`);
      const existingId = sku ? (bySku.get(key(sku)) ?? null) : null;
      const unit = value(C.unit) || 'un';
      if (unit.length > 10) errors.push('Unidade com mais de 10 caracteres');
      const initialStock = number(value(C.initialStock), C.initialStock, errors, { max: 9_999_999 });
      const trackStock = yesNo(value(C.trackStock), C.trackStock, errors);
      if (initialStock && existingId) errors.push('O stock inicial so se indica em produtos novos (use um inventario ou um ajuste)');
      if (initialStock && !existingId && trackStock !== true) errors.push('Para ter stock inicial, Controla stock tem de ser Sim');
      rows.push({
        line,
        sku,
        name,
        category,
        action: existingId ? 'UPDATE' : 'CREATE',
        errors,
        existingId,
        data: {
          unit,
          price: number(value(C.price), C.price, errors, { required: true }) ?? 0,
          cost: number(value(C.cost), C.cost, errors),
          taxRateId,
          sellable: yesNo(value(C.sellable), C.sellable, errors),
          roomService: yesNo(value(C.roomService), C.roomService, errors),
          trackStock,
          minStock: number(value(C.minStock), C.minStock, errors, { max: 9_999_999 }),
          initialStock,
          warehouseId: warehouse?.id ?? null,
          active: yesNo(value(C.active), C.active, errors),
        },
      });
    }
    if (!rows.length && last <= 1) throw new BadRequestException('O ficheiro nao tem produtos');
    if (!rows.length) throw new BadRequestException('O ficheiro nao tem produtos');
    return { rows, newCategories: [...newCategories.values()] };
  }

  private workbook() {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'MAVIE-HGest';
    workbook.created = new Date();
    return workbook;
  }

  private productsSheet(workbook: ExcelJS.Workbook, titles: string[]) {
    const sheet = workbook.addWorksheet(SHEET, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = titles.map((title) => ({ header: title, width: Math.max(12, title.length + 4) }));
    sheet.getColumn(2).width = 36;
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
    return sheet;
  }

  private hotel(user: JwtPayload, hotelId?: number) {
    const scoped = resolveHotelScope(user, hotelId);
    if (!scoped) throw new BadRequestException('hotelId e obrigatorio');
    return scoped;
  }
}
