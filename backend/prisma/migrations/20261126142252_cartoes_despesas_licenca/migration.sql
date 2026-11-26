-- AlterTable
ALTER TABLE `hotels` ADD COLUMN `licenseGraceUntil` DATETIME(3) NULL,
    ADD COLUMN `licenseLastSeenAt` DATETIME(3) NULL,
    ADD COLUMN `licenseText` TEXT NULL,
    ADD COLUMN `licenseUnlocks` TEXT NULL,
    ADD COLUMN `productionSince` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `payment_types` ADD COLUMN `isEventCard` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `event_cards` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hotelId` INTEGER NOT NULL,
    `number` VARCHAR(40) NOT NULL,
    `holder` VARCHAR(120) NULL,
    `guestId` INTEGER NULL,
    `balance` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `event_cards_guestId_idx`(`guestId`),
    UNIQUE INDEX `event_cards_hotelId_number_key`(`hotelId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_card_movements` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `cardId` INTEGER NOT NULL,
    `guestId` INTEGER NULL,
    `type` ENUM('LOAD', 'TOPUP', 'PAYMENT', 'REFUND', 'DISCHARGE', 'TRANSFER_OUT', 'TRANSFER_IN', 'GUEST_CHANGE') NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `balanceAfter` DECIMAL(12, 2) NOT NULL,
    `loadPaymentId` INTEGER NULL,
    `usePaymentId` INTEGER NULL,
    `orderId` INTEGER NULL,
    `dischargeId` INTEGER NULL,
    `cashSessionId` INTEGER NULL,
    `reason` VARCHAR(200) NULL,
    `idempotencyKey` VARCHAR(80) NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `event_card_movements_loadPaymentId_key`(`loadPaymentId`),
    UNIQUE INDEX `event_card_movements_usePaymentId_key`(`usePaymentId`),
    UNIQUE INDEX `event_card_movements_idempotencyKey_key`(`idempotencyKey`),
    INDEX `event_card_movements_cardId_createdAt_idx`(`cardId`, `createdAt`),
    INDEX `event_card_movements_guestId_idx`(`guestId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_card_discharges` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hotelId` INTEGER NOT NULL,
    `refunded` BOOLEAN NOT NULL,
    `paymentTypeId` INTEGER NULL,
    `cashSessionId` INTEGER NULL,
    `reference` VARCHAR(100) NULL,
    `reason` VARCHAR(200) NOT NULL,
    `total` DECIMAL(12, 2) NOT NULL,
    `cards` INTEGER NOT NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `event_card_discharges_hotelId_createdAt_idx`(`hotelId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `expense_categories` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hotelId` INTEGER NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `expense_categories_hotelId_name_key`(`hotelId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `expenses` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hotelId` INTEGER NOT NULL,
    `categoryId` INTEGER NOT NULL,
    `description` VARCHAR(200) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `date` DATE NOT NULL,
    `supplierId` INTEGER NULL,
    `documentRef` VARCHAR(60) NULL,
    `paymentTypeId` INTEGER NULL,
    `cashSessionId` INTEGER NULL,
    `cashMovementId` INTEGER NULL,
    `status` ENUM('CONFIRMED', 'VOIDED') NOT NULL DEFAULT 'CONFIRMED',
    `voidReason` VARCHAR(200) NULL,
    `voidedAt` DATETIME(3) NULL,
    `voidedById` INTEGER NULL,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `expenses_hotelId_date_idx`(`hotelId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_option_groups` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `productId` INTEGER NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `required` BOOLEAN NOT NULL DEFAULT true,
    `maxChoices` INTEGER NOT NULL DEFAULT 1,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,

    INDEX `product_option_groups_productId_idx`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_options` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `groupId` INTEGER NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `priceDelta` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `ingredientId` INTEGER NULL,
    `quantity` DECIMAL(12, 3) NOT NULL DEFAULT 0,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,

    INDEX `product_options_groupId_idx`(`groupId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_item_options` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderItemId` INTEGER NOT NULL,
    `optionId` INTEGER NULL,
    `groupName` VARCHAR(60) NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `priceDelta` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `ingredientId` INTEGER NULL,
    `quantity` DECIMAL(12, 3) NOT NULL DEFAULT 0,

    INDEX `order_item_options_orderItemId_idx`(`orderItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `event_cards` ADD CONSTRAINT `event_cards_hotelId_fkey` FOREIGN KEY (`hotelId`) REFERENCES `hotels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_cards` ADD CONSTRAINT `event_cards_guestId_fkey` FOREIGN KEY (`guestId`) REFERENCES `guests`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_card_movements` ADD CONSTRAINT `event_card_movements_cardId_fkey` FOREIGN KEY (`cardId`) REFERENCES `event_cards`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_card_movements` ADD CONSTRAINT `event_card_movements_loadPaymentId_fkey` FOREIGN KEY (`loadPaymentId`) REFERENCES `payments`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `event_card_movements` ADD CONSTRAINT `event_card_movements_usePaymentId_fkey` FOREIGN KEY (`usePaymentId`) REFERENCES `payments`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `event_card_movements` ADD CONSTRAINT `event_card_movements_dischargeId_fkey` FOREIGN KEY (`dischargeId`) REFERENCES `event_card_discharges`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `event_card_movements` ADD CONSTRAINT `event_card_movements_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_card_discharges` ADD CONSTRAINT `event_card_discharges_hotelId_fkey` FOREIGN KEY (`hotelId`) REFERENCES `hotels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_card_discharges` ADD CONSTRAINT `event_card_discharges_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expense_categories` ADD CONSTRAINT `expense_categories_hotelId_fkey` FOREIGN KEY (`hotelId`) REFERENCES `hotels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_hotelId_fkey` FOREIGN KEY (`hotelId`) REFERENCES `hotels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `expense_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_paymentTypeId_fkey` FOREIGN KEY (`paymentTypeId`) REFERENCES `payment_types`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_option_groups` ADD CONSTRAINT `product_option_groups_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_options` ADD CONSTRAINT `product_options_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `product_option_groups`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_options` ADD CONSTRAINT `product_options_ingredientId_fkey` FOREIGN KEY (`ingredientId`) REFERENCES `products`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_item_options` ADD CONSTRAINT `order_item_options_orderItemId_fkey` FOREIGN KEY (`orderItemId`) REFERENCES `order_items`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_item_options` ADD CONSTRAINT `order_item_options_optionId_fkey` FOREIGN KEY (`optionId`) REFERENCES `product_options`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE `hotels` SET `productionSince` = CURRENT_TIMESTAMP(3), `licenseGraceUntil` = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 30 DAY);
