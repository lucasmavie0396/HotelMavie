-- AlterTable
ALTER TABLE `hotels` ADD COLUMN `ticketFooter` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `payments` ADD COLUMN `paymentTypeId` INTEGER NULL;

-- AlterTable
ALTER TABLE `product_categories` ADD COLUMN `printerId` INTEGER NULL;

-- AlterTable
ALTER TABLE `receipts` ADD COLUMN `paymentTypeId` INTEGER NULL;

-- CreateTable
CREATE TABLE `printers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hotelId` INTEGER NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `purpose` ENUM('RECEIPT', 'KITCHEN', 'BAR', 'OTHER') NOT NULL,
    `connection` ENUM('BROWSER', 'NETWORK') NOT NULL DEFAULT 'BROWSER',
    `host` VARCHAR(100) NULL,
    `port` INTEGER NOT NULL DEFAULT 9100,
    `paperWidth` ENUM('MM58', 'MM80', 'A4') NOT NULL DEFAULT 'MM80',
    `copies` INTEGER NOT NULL DEFAULT 1,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `printers_hotelId_purpose_idx`(`hotelId`, `purpose`),
    UNIQUE INDEX `printers_hotelId_name_key`(`hotelId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_types` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hotelId` INTEGER NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `kind` ENUM('CASH', 'CARD', 'TRANSFER', 'MOBILE', 'OTHER') NOT NULL,
    `mechanism` VARCHAR(2) NULL,
    `requiresReference` BOOLEAN NOT NULL DEFAULT false,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payment_types_hotelId_name_key`(`hotelId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_paymentTypeId_fkey` FOREIGN KEY (`paymentTypeId`) REFERENCES `payment_types`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_categories` ADD CONSTRAINT `product_categories_printerId_fkey` FOREIGN KEY (`printerId`) REFERENCES `printers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_paymentTypeId_fkey` FOREIGN KEY (`paymentTypeId`) REFERENCES `payment_types`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `printers` ADD CONSTRAINT `printers_hotelId_fkey` FOREIGN KEY (`hotelId`) REFERENCES `hotels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_types` ADD CONSTRAINT `payment_types_hotelId_fkey` FOREIGN KEY (`hotelId`) REFERENCES `hotels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Default payment types for existing hotels
INSERT INTO `payment_types` (`hotelId`, `name`, `kind`, `mechanism`, `requiresReference`, `sortOrder`)
SELECT `id`, 'Numerario', 'CASH', 'NU', false, 1 FROM `hotels`
UNION ALL SELECT `id`, 'Cartao', 'CARD', 'CC', false, 2 FROM `hotels`
UNION ALL SELECT `id`, 'Transferencia', 'TRANSFER', 'TB', true, 3 FROM `hotels`
UNION ALL SELECT `id`, 'Pagamento movel', 'MOBILE', 'OU', true, 4 FROM `hotels`
UNION ALL SELECT `id`, 'Outro', 'OTHER', 'OU', false, 5 FROM `hotels`;

-- Link existing payments and receipts to the matching default type
UPDATE `payments` p JOIN `payment_types` t ON t.`hotelId` = p.`hotelId` AND t.`kind` = p.`method` SET p.`paymentTypeId` = t.`id`;
UPDATE `receipts` r JOIN `payment_types` t ON t.`hotelId` = r.`hotelId` AND t.`kind` = r.`method` SET r.`paymentTypeId` = t.`id`;
