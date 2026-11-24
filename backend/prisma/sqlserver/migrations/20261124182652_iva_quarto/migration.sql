BEGIN TRY

BEGIN TRAN;

-- DropForeignKey
ALTER TABLE [dbo].[rooms] DROP CONSTRAINT [rooms_hotelId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[charges] DROP CONSTRAINT [charges_taxRateId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[orders] DROP CONSTRAINT [orders_tableId_fkey];

-- AlterTable
ALTER TABLE [dbo].[rooms] ADD [taxRateId] INT;

-- AddForeignKey
ALTER TABLE [dbo].[rooms] ADD CONSTRAINT [rooms_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[rooms] ADD CONSTRAINT [rooms_taxRateId_fkey] FOREIGN KEY ([taxRateId]) REFERENCES [dbo].[tax_rates]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[charges] ADD CONSTRAINT [charges_taxRateId_fkey] FOREIGN KEY ([taxRateId]) REFERENCES [dbo].[tax_rates]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[orders] ADD CONSTRAINT [orders_tableId_fkey] FOREIGN KEY ([tableId]) REFERENCES [dbo].[dining_tables]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

