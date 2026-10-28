-- CreateTable
CREATE TABLE `employees` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hotelId` INTEGER NOT NULL,
    `userId` INTEGER NULL,
    `fullName` VARCHAR(150) NOT NULL,
    `jobTitle` VARCHAR(80) NOT NULL,
    `department` VARCHAR(60) NULL,
    `email` VARCHAR(150) NULL,
    `phone` VARCHAR(30) NULL,
    `taxId` VARCHAR(30) NULL,
    `socialSecurityNumber` VARCHAR(30) NULL,
    `iban` VARCHAR(40) NULL,
    `contractType` ENUM('PERMANENT', 'FIXED_TERM', 'PART_TIME', 'INTERN', 'OTHER') NOT NULL DEFAULT 'PERMANENT',
    `startDate` DATE NOT NULL,
    `endDate` DATE NULL,
    `weeklyHours` DECIMAL(5, 2) NOT NULL DEFAULT 40,
    `baseSalary` DECIMAL(12, 2) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `employees_userId_key`(`userId`),
    INDEX `employees_hotelId_active_idx`(`hotelId`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shifts` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hotelId` INTEGER NOT NULL,
    `employeeId` INTEGER NOT NULL,
    `date` DATE NOT NULL,
    `startTime` VARCHAR(5) NOT NULL,
    `endTime` VARCHAR(5) NOT NULL,
    `breakMinutes` INTEGER NOT NULL DEFAULT 0,
    `notes` VARCHAR(200) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `shifts_hotelId_date_idx`(`hotelId`, `date`),
    INDEX `shifts_employeeId_date_idx`(`employeeId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `time_entries` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hotelId` INTEGER NOT NULL,
    `employeeId` INTEGER NOT NULL,
    `clockIn` DATETIME(3) NOT NULL,
    `clockOut` DATETIME(3) NULL,
    `source` ENUM('SELF', 'MANAGER') NOT NULL DEFAULT 'SELF',
    `notes` VARCHAR(200) NULL,
    `editedById` INTEGER NULL,
    `editedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `time_entries_employeeId_clockIn_idx`(`employeeId`, `clockIn`),
    INDEX `time_entries_hotelId_clockIn_idx`(`hotelId`, `clockIn`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_hotelId_fkey` FOREIGN KEY (`hotelId`) REFERENCES `hotels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `employees` ADD CONSTRAINT `employees_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shifts` ADD CONSTRAINT `shifts_hotelId_fkey` FOREIGN KEY (`hotelId`) REFERENCES `hotels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shifts` ADD CONSTRAINT `shifts_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `time_entries` ADD CONSTRAINT `time_entries_hotelId_fkey` FOREIGN KEY (`hotelId`) REFERENCES `hotels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `time_entries` ADD CONSTRAINT `time_entries_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `time_entries` ADD CONSTRAINT `time_entries_editedById_fkey` FOREIGN KEY (`editedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
