-- AlterTable
ALTER TABLE `products` ADD COLUMN `trackExpiry` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `purchase_items` ADD COLUMN `receivedQuantity` DECIMAL(12, 3) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `purchases` ADD COLUMN `sentAt` DATETIME(3) NULL,
    MODIFY `status` ENUM('DRAFT', 'PARTIAL', 'RECEIVED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE `stock_documents` ADD COLUMN `number` INTEGER NULL,
    ADD COLUMN `supplierId` INTEGER NULL,
    ADD COLUMN `year` INTEGER NULL,
    MODIFY `type` ENUM('INVENTORY', 'WASTE', 'TRANSFER', 'RETURN') NOT NULL;

-- AlterTable
ALTER TABLE `stock_movements` MODIFY `type` ENUM('PURCHASE', 'SALE', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'WASTE', 'RETURN') NOT NULL;

-- CreateTable
CREATE TABLE `stock_document_series` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hotelId` INTEGER NOT NULL,
    `type` ENUM('INVENTORY', 'WASTE', 'TRANSFER', 'RETURN') NOT NULL,
    `year` INTEGER NOT NULL,
    `nextNumber` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `stock_document_series_hotelId_type_year_key`(`hotelId`, `type`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stock_lots` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `warehouseId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `code` VARCHAR(40) NULL,
    `expiryDate` DATE NULL,
    `quantity` DECIMAL(12, 3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `stock_lots_warehouseId_productId_idx`(`warehouseId`, `productId`),
    INDEX `stock_lots_expiryDate_idx`(`expiryDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `stock_documents_hotelId_type_year_number_key` ON `stock_documents`(`hotelId`, `type`, `year`, `number`);

-- AddForeignKey
ALTER TABLE `stock_documents` ADD CONSTRAINT `stock_documents_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_document_series` ADD CONSTRAINT `stock_document_series_hotelId_fkey` FOREIGN KEY (`hotelId`) REFERENCES `hotels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_lots` ADD CONSTRAINT `stock_lots_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `stock_lots` ADD CONSTRAINT `stock_lots_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill
UPDATE `purchase_items` pi JOIN `purchases` p ON p.id = pi.purchaseId SET pi.receivedQuantity = pi.quantity WHERE p.status = 'RECEIVED';
