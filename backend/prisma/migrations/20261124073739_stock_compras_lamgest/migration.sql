-- AlterTable
ALTER TABLE `hotels` ADD COLUMN `allowNegativeStock` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `products` ADD COLUMN `allowNegativeStock` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `purchase_items` ADD COLUMN `discount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `taxAmount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `taxRate` DECIMAL(5, 2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `purchases` ADD COLUMN `cancelReason` VARCHAR(200) NULL,
    ADD COLUMN `cancelledAt` DATETIME(3) NULL,
    ADD COLUMN `cancelledById` INTEGER NULL,
    ADD COLUMN `discount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `documentDate` DATE NULL,
    ADD COLUMN `dueDate` DATE NULL,
    ADD COLUMN `subtotal` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN `taxTotal` DECIMAL(12, 2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `stock_movements` MODIFY `type` ENUM('PURCHASE', 'SALE', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'WASTE', 'RETURN', 'PURCHASE_VOID') NOT NULL;

-- AddForeignKey
ALTER TABLE `purchases` ADD CONSTRAINT `purchases_cancelledById_fkey` FOREIGN KEY (`cancelledById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE `hotels` SET `allowNegativeStock` = true;

UPDATE `purchases` SET `subtotal` = `total`;
