-- AlterTable
ALTER TABLE `invoices` ADD COLUMN `dueDate` DATE NULL,
    ADD COLUMN `notes` VARCHAR(1000) NULL;

-- CreateTable
CREATE TABLE `quotes` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hotelId` INTEGER NOT NULL,
    `year` INTEGER NOT NULL,
    `number` INTEGER NOT NULL,
    `fullNumber` VARCHAR(40) NOT NULL,
    `status` ENUM('OPEN', 'CONVERTED', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `validUntil` DATE NOT NULL,
    `customerName` VARCHAR(200) NOT NULL,
    `customerTaxId` VARCHAR(30) NULL,
    `customerAddress` VARCHAR(255) NULL,
    `customerEmail` VARCHAR(150) NULL,
    `notes` VARCHAR(1000) NULL,
    `currency` VARCHAR(3) NOT NULL,
    `netTotal` DECIMAL(12, 2) NOT NULL,
    `taxTotal` DECIMAL(12, 2) NOT NULL,
    `grossTotal` DECIMAL(12, 2) NOT NULL,
    `invoiceId` INTEGER NULL,
    `cancelReason` VARCHAR(255) NULL,
    `createdById` INTEGER NULL,

    UNIQUE INDEX `quotes_invoiceId_key`(`invoiceId`),
    INDEX `quotes_hotelId_issuedAt_idx`(`hotelId`, `issuedAt`),
    UNIQUE INDEX `quotes_hotelId_year_number_key`(`hotelId`, `year`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quote_lines` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `quoteId` INTEGER NOT NULL,
    `position` INTEGER NOT NULL,
    `productId` INTEGER NULL,
    `productCode` VARCHAR(60) NULL,
    `description` VARCHAR(200) NOT NULL,
    `quantity` DECIMAL(10, 3) NOT NULL,
    `unitPrice` DECIMAL(12, 2) NOT NULL,
    `discount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `taxRateId` INTEGER NULL,
    `taxRate` DECIMAL(5, 2) NOT NULL,
    `netAmount` DECIMAL(12, 2) NOT NULL,
    `taxAmount` DECIMAL(12, 2) NOT NULL,
    `grossAmount` DECIMAL(12, 2) NOT NULL,

    INDEX `quote_lines_quoteId_idx`(`quoteId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `quotes` ADD CONSTRAINT `quotes_hotelId_fkey` FOREIGN KEY (`hotelId`) REFERENCES `hotels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotes` ADD CONSTRAINT `quotes_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quotes` ADD CONSTRAINT `quotes_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quote_lines` ADD CONSTRAINT `quote_lines_quoteId_fkey` FOREIGN KEY (`quoteId`) REFERENCES `quotes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quote_lines` ADD CONSTRAINT `quote_lines_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quote_lines` ADD CONSTRAINT `quote_lines_taxRateId_fkey` FOREIGN KEY (`taxRateId`) REFERENCES `tax_rates`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
