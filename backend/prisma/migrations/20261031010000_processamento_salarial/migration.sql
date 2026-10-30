-- AlterTable
ALTER TABLE `employees` ADD COLUMN `irsRate` DECIMAL(5, 2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `payroll_settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hotelId` INTEGER NOT NULL,
    `employeeSsRate` DECIMAL(5, 2) NOT NULL DEFAULT 11,
    `employerSsRate` DECIMAL(5, 2) NOT NULL DEFAULT 23.75,
    `overtimeMultiplier` DECIMAL(4, 2) NOT NULL DEFAULT 1.25,
    `subsidiesInTwelfths` BOOLEAN NOT NULL DEFAULT false,
    `holidayPayMonth` INTEGER NOT NULL DEFAULT 6,
    `christmasPayMonth` INTEGER NOT NULL DEFAULT 12,

    UNIQUE INDEX `payroll_settings_hotelId_key`(`hotelId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payroll_runs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hotelId` INTEGER NOT NULL,
    `year` INTEGER NOT NULL,
    `month` INTEGER NOT NULL,
    `status` ENUM('DRAFT', 'CLOSED') NOT NULL DEFAULT 'DRAFT',
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `closedAt` DATETIME(3) NULL,

    UNIQUE INDEX `payroll_runs_hotelId_year_month_key`(`hotelId`, `year`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payslips` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `runId` INTEGER NOT NULL,
    `employeeId` INTEGER NOT NULL,
    `fullName` VARCHAR(150) NOT NULL,
    `jobTitle` VARCHAR(80) NOT NULL,
    `taxId` VARCHAR(30) NULL,
    `socialSecurityNumber` VARCHAR(30) NULL,
    `iban` VARCHAR(40) NULL,
    `weeklyHours` DECIMAL(5, 2) NOT NULL,
    `baseSalary` DECIMAL(12, 2) NOT NULL,
    `hourlyRate` DECIMAL(12, 4) NOT NULL,
    `scheduledHours` DECIMAL(8, 2) NOT NULL DEFAULT 0,
    `workedHours` DECIMAL(8, 2) NOT NULL DEFAULT 0,
    `absenceHours` DECIMAL(8, 2) NOT NULL DEFAULT 0,
    `absenceDeduction` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `overtimeHours` DECIMAL(8, 2) NOT NULL DEFAULT 0,
    `overtimePay` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `holidayPay` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `christmasPay` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `otherEarnings` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `grossPay` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `ssBase` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `employeeSsRate` DECIMAL(5, 2) NOT NULL,
    `employeeSs` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `irsRate` DECIMAL(5, 2) NOT NULL,
    `irsWithholding` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `otherDeductions` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `netPay` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `employerSsRate` DECIMAL(5, 2) NOT NULL,
    `employerSs` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `extraLines` JSON NULL,
    `notes` VARCHAR(255) NULL,
    `manual` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `payslips_runId_employeeId_key`(`runId`, `employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `payroll_settings` ADD CONSTRAINT `payroll_settings_hotelId_fkey` FOREIGN KEY (`hotelId`) REFERENCES `hotels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_hotelId_fkey` FOREIGN KEY (`hotelId`) REFERENCES `hotels`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payroll_runs` ADD CONSTRAINT `payroll_runs_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payslips` ADD CONSTRAINT `payslips_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `payroll_runs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payslips` ADD CONSTRAINT `payslips_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

