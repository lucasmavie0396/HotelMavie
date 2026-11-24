-- AlterTable
ALTER TABLE `rooms` ADD COLUMN `taxRateId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `rooms` ADD CONSTRAINT `rooms_taxRateId_fkey` FOREIGN KEY (`taxRateId`) REFERENCES `tax_rates`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
