-- AlterTable
ALTER TABLE `hotels` ADD COLUMN `paymentInstructionsEn` TEXT NULL,
    ADD COLUMN `publicDescriptionEn` TEXT NULL;

-- AlterTable
ALTER TABLE `reservations` ADD COLUMN `locale` VARCHAR(5) NOT NULL DEFAULT 'pt';

-- AlterTable
ALTER TABLE `rooms` ADD COLUMN `descriptionEn` TEXT NULL;

