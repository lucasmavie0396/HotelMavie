-- AlterTable
ALTER TABLE `hotels` ADD COLUMN `customDomain` VARCHAR(253) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `hotels_customDomain_key` ON `hotels`(`customDomain`);

