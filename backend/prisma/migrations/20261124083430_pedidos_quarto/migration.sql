-- AlterTable
ALTER TABLE `hotels` ADD COLUMN `roomServiceAutoAccept` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `roomServiceBarHours` VARCHAR(11) NULL,
    ADD COLUMN `roomServiceRestaurantHours` VARCHAR(11) NULL;

-- AlterTable
ALTER TABLE `orders` ADD COLUMN `acceptedAt` DATETIME(3) NULL,
    ADD COLUMN `deliveredAt` DATETIME(3) NULL,
    ADD COLUMN `dispatchedAt` DATETIME(3) NULL,
    ADD COLUMN `rejectReason` VARCHAR(200) NULL,
    ADD COLUMN `roomDeviceId` INTEGER NULL,
    ADD COLUMN `roomId` INTEGER NULL,
    ADD COLUMN `roomServiceStatus` ENUM('PENDING', 'ACCEPTED', 'ON_THE_WAY', 'DELIVERED', 'REJECTED') NULL;

-- AlterTable
ALTER TABLE `products` ADD COLUMN `roomService` BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE `reservations` ADD COLUMN `roomServiceBlocked` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `roomServiceLimit` DECIMAL(12, 2) NULL;

-- CreateTable
CREATE TABLE `room_devices` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hotelId` INTEGER NOT NULL,
    `roomId` INTEGER NOT NULL,
    `name` VARCHAR(60) NULL,
    `tokenHash` VARCHAR(64) NULL,
    `pairingCode` VARCHAR(6) NULL,
    `pairingExpiresAt` DATETIME(3) NULL,
    `pairedAt` DATETIME(3) NULL,
    `lastSeenAt` DATETIME(3) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `room_devices_tokenHash_key`(`tokenHash`),
    INDEX `room_devices_hotelId_idx`(`hotelId`),
    INDEX `room_devices_pairingCode_idx`(`pairingCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `orders_hotelId_roomServiceStatus_idx` ON `orders`(`hotelId`, `roomServiceStatus`);

-- AddForeignKey
ALTER TABLE `room_devices` ADD CONSTRAINT `room_devices_hotelId_fkey` FOREIGN KEY (`hotelId`) REFERENCES `hotels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `room_devices` ADD CONSTRAINT `room_devices_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `rooms`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `rooms`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_roomDeviceId_fkey` FOREIGN KEY (`roomDeviceId`) REFERENCES `room_devices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
