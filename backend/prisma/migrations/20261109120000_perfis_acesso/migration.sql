-- AlterTable
ALTER TABLE `users` ADD COLUMN `profileId` INTEGER NULL;

-- CreateTable
CREATE TABLE `access_profiles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hotelId` INTEGER NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `baseRole` ENUM('ADMIN', 'MANAGER', 'RECEPTION', 'CASHIER') NOT NULL DEFAULT 'RECEPTION',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `access_profiles_hotelId_name_key`(`hotelId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `access_profile_permissions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `profileId` INTEGER NOT NULL,
    `area` VARCHAR(40) NOT NULL,
    `level` ENUM('NONE', 'VIEW', 'MANAGE') NOT NULL,

    UNIQUE INDEX `access_profile_permissions_profileId_area_key`(`profileId`, `area`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `users_profileId_idx` ON `users`(`profileId`);

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_profileId_fkey` FOREIGN KEY (`profileId`) REFERENCES `access_profiles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `access_profiles` ADD CONSTRAINT `access_profiles_hotelId_fkey` FOREIGN KEY (`hotelId`) REFERENCES `hotels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `access_profile_permissions` ADD CONSTRAINT `access_profile_permissions_profileId_fkey` FOREIGN KEY (`profileId`) REFERENCES `access_profiles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

