-- AlterTable
ALTER TABLE `product_categories` ADD COLUMN `warehouseId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `product_categories` ADD CONSTRAINT `product_categories_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

