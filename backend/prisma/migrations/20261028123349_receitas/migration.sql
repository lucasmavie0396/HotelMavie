-- CreateTable
CREATE TABLE `recipe_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `productId` INTEGER NOT NULL,
    `ingredientId` INTEGER NOT NULL,
    `quantity` DECIMAL(12, 3) NOT NULL,

    INDEX `recipe_items_ingredientId_idx`(`ingredientId`),
    UNIQUE INDEX `recipe_items_productId_ingredientId_key`(`productId`, `ingredientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `recipe_items` ADD CONSTRAINT `recipe_items_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recipe_items` ADD CONSTRAINT `recipe_items_ingredientId_fkey` FOREIGN KEY (`ingredientId`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
