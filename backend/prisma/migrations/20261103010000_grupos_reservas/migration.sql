-- AlterTable
ALTER TABLE `reservations` ADD COLUMN `groupId` INTEGER NULL;

-- CreateTable
CREATE TABLE `reservation_groups` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(20) NOT NULL,
    `hotelId` INTEGER NOT NULL,
    `kind` ENUM('INDIVIDUAL', 'CORPORATE') NOT NULL DEFAULT 'INDIVIDUAL',
    `companyName` VARCHAR(200) NULL,
    `companyTaxId` VARCHAR(30) NULL,
    `companyAddress` VARCHAR(255) NULL,
    `companyEmail` VARCHAR(150) NULL,
    `companyPhone` VARCHAR(30) NULL,
    `contactName` VARCHAR(150) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `reservation_groups_code_key`(`code`),
    INDEX `reservation_groups_hotelId_companyTaxId_idx`(`hotelId`, `companyTaxId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `reservations_groupId_idx` ON `reservations`(`groupId`);

-- AddForeignKey
ALTER TABLE `reservation_groups` ADD CONSTRAINT `reservation_groups_hotelId_fkey` FOREIGN KEY (`hotelId`) REFERENCES `hotels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reservations` ADD CONSTRAINT `reservations_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `reservation_groups`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
