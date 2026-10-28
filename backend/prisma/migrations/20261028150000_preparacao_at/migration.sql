-- AlterTable
ALTER TABLE `charges` ADD COLUMN `productCode` VARCHAR(60) NULL;

-- AlterTable
ALTER TABLE `hotels` ADD COLUMN `city` VARCHAR(100) NULL,
    ADD COLUMN `country` VARCHAR(2) NOT NULL DEFAULT 'PT',
    ADD COLUMN `postalCode` VARCHAR(20) NULL;

-- AlterTable
ALTER TABLE `invoice_lines` ADD COLUMN `exemptionCode` VARCHAR(3) NULL,
    ADD COLUMN `productCode` VARCHAR(60) NOT NULL DEFAULT 'GERAL',
    ADD COLUMN `taxCategory` ENUM('RED', 'INT', 'NOR', 'ISE') NOT NULL DEFAULT 'NOR';

-- AlterTable
ALTER TABLE `invoice_series` ADD COLUMN `atValidationCode` VARCHAR(20) NULL,
    MODIFY `lastHash` VARCHAR(255) NULL;

-- AlterTable
ALTER TABLE `invoices` ADD COLUMN `atcud` VARCHAR(80) NULL,
    ADD COLUMN `keyVersion` INTEGER NOT NULL DEFAULT 1,
    MODIFY `previousHash` VARCHAR(255) NULL,
    MODIFY `hash` VARCHAR(255) NOT NULL;

-- AlterTable
ALTER TABLE `tax_rates` ADD COLUMN `atCategory` ENUM('RED', 'INT', 'NOR', 'ISE') NOT NULL DEFAULT 'NOR',
    ADD COLUMN `exemptionCode` VARCHAR(3) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `invoice_series_hotelId_type_code_key` ON `invoice_series`(`hotelId`, `type`, `code`);

-- DropIndex
DROP INDEX `invoice_series_hotelId_code_key` ON `invoice_series`;
