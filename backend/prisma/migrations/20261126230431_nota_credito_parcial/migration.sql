-- AlterTable
ALTER TABLE `invoice_lines` ADD COLUMN `creditOfLineId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `invoice_lines_creditOfLineId_idx` ON `invoice_lines`(`creditOfLineId`);

-- AddForeignKey
ALTER TABLE `invoice_lines` ADD CONSTRAINT `invoice_lines_creditOfLineId_fkey` FOREIGN KEY (`creditOfLineId`) REFERENCES `invoice_lines`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
