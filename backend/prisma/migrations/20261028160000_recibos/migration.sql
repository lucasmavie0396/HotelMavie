-- AlterTable
ALTER TABLE `invoice_series` MODIFY `type` ENUM('INVOICE', 'INVOICE_RECEIPT', 'CREDIT_NOTE', 'RECEIPT') NOT NULL;

-- AlterTable
ALTER TABLE `invoices` MODIFY `type` ENUM('INVOICE', 'INVOICE_RECEIPT', 'CREDIT_NOTE', 'RECEIPT') NOT NULL;

-- AlterTable
ALTER TABLE `payments` ADD COLUMN `receiptId` INTEGER NULL;

-- CreateTable
CREATE TABLE `receipts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hotelId` INTEGER NOT NULL,
    `seriesId` INTEGER NOT NULL,
    `number` INTEGER NOT NULL,
    `fullNumber` VARCHAR(40) NOT NULL,
    `atcud` VARCHAR(80) NULL,
    `status` ENUM('ISSUED', 'CANCELLED') NOT NULL DEFAULT 'ISSUED',
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `customerName` VARCHAR(200) NOT NULL,
    `customerTaxId` VARCHAR(30) NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `method` ENUM('CASH', 'CARD', 'TRANSFER', 'MOBILE', 'OTHER') NOT NULL,
    `reference` VARCHAR(100) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `cancelReason` VARCHAR(255) NULL,
    `createdById` INTEGER NULL,

    INDEX `receipts_hotelId_issuedAt_idx`(`hotelId`, `issuedAt`),
    UNIQUE INDEX `receipts_seriesId_number_key`(`seriesId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `receipt_lines` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `receiptId` INTEGER NOT NULL,
    `invoiceId` INTEGER NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,

    INDEX `receipt_lines_receiptId_idx`(`receiptId`),
    INDEX `receipt_lines_invoiceId_idx`(`invoiceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `payments` ADD CONSTRAINT `payments_receiptId_fkey` FOREIGN KEY (`receiptId`) REFERENCES `receipts`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_hotelId_fkey` FOREIGN KEY (`hotelId`) REFERENCES `hotels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_seriesId_fkey` FOREIGN KEY (`seriesId`) REFERENCES `invoice_series`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipt_lines` ADD CONSTRAINT `receipt_lines_receiptId_fkey` FOREIGN KEY (`receiptId`) REFERENCES `receipts`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipt_lines` ADD CONSTRAINT `receipt_lines_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `invoices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
