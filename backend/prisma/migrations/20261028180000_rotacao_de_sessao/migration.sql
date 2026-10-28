-- AlterTable
ALTER TABLE `user_sessions` ADD COLUMN `previousTokenHash` VARCHAR(64) NULL,
    ADD COLUMN `rotatedAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `user_sessions_previousTokenHash_idx` ON `user_sessions`(`previousTokenHash`);
