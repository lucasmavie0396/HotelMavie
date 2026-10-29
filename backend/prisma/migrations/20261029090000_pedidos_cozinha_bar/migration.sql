-- AlterTable
ALTER TABLE `product_categories` ADD COLUMN `prepStation` ENUM('KITCHEN', 'BAR', 'NONE') NOT NULL DEFAULT 'KITCHEN';

-- AlterTable
ALTER TABLE `order_items` ADD COLUMN `sentAt` DATETIME(3) NULL,
    ADD COLUMN `voidedAt` DATETIME(3) NULL,
    ADD COLUMN `voidReason` VARCHAR(200) NULL,
    ADD COLUMN `voidedById` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_voidedById_fkey` FOREIGN KEY (`voidedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing bar categories send to the bar
UPDATE `product_categories` SET `prepStation` = 'BAR' WHERE `outlet` = 'BAR';
