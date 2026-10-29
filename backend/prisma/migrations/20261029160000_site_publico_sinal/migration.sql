-- AlterTable
ALTER TABLE `hotels` ADD COLUMN `depositPercent` DECIMAL(5, 2) NOT NULL DEFAULT 60,
    ADD COLUMN `logoFile` VARCHAR(100) NULL,
    ADD COLUMN `paymentInstructions` TEXT NULL,
    ADD COLUMN `publicDescription` TEXT NULL;

-- AlterTable
ALTER TABLE `printers` ADD COLUMN `localName` VARCHAR(200) NULL,
    MODIFY `connection` ENUM('BROWSER', 'NETWORK', 'LOCAL') NOT NULL DEFAULT 'BROWSER';

-- AlterTable
ALTER TABLE `reservations` ADD COLUMN `depositAmount` DECIMAL(12, 2) NULL,
    ADD COLUMN `depositConfirmedAt` DATETIME(3) NULL,
    ADD COLUMN `depositConfirmedById` INTEGER NULL,
    ADD COLUMN `depositPaymentId` INTEGER NULL,
    ADD COLUMN `depositPaymentTypeId` INTEGER NULL,
    ADD COLUMN `depositReference` VARCHAR(100) NULL;

-- CreateTable
CREATE TABLE `room_images` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `roomId` INTEGER NOT NULL,
    `file` VARCHAR(100) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `room_images_roomId_idx`(`roomId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `reservations_depositPaymentId_key` ON `reservations`(`depositPaymentId`);

-- AddForeignKey
ALTER TABLE `room_images` ADD CONSTRAINT `room_images_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `rooms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reservations` ADD CONSTRAINT `reservations_depositPaymentTypeId_fkey` FOREIGN KEY (`depositPaymentTypeId`) REFERENCES `payment_types`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reservations` ADD CONSTRAINT `reservations_depositPaymentId_fkey` FOREIGN KEY (`depositPaymentId`) REFERENCES `payments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reservations` ADD CONSTRAINT `reservations_depositConfirmedById_fkey` FOREIGN KEY (`depositConfirmedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

