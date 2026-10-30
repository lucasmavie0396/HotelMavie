-- AlterTable
ALTER TABLE `orders` ADD COLUMN `tableId` INTEGER NULL;

-- CreateTable
CREATE TABLE `dining_tables` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hotelId` INTEGER NOT NULL,
    `outlet` ENUM('RESTAURANT', 'BAR') NOT NULL,
    `number` INTEGER NOT NULL,
    `name` VARCHAR(40) NULL,
    `seats` INTEGER NOT NULL DEFAULT 4,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `dining_tables_hotelId_outlet_number_key`(`hotelId`, `outlet`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `orders_tableId_status_idx` ON `orders`(`tableId`, `status`);

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_tableId_fkey` FOREIGN KEY (`tableId`) REFERENCES `dining_tables`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dining_tables` ADD CONSTRAINT `dining_tables_hotelId_fkey` FOREIGN KEY (`hotelId`) REFERENCES `hotels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

