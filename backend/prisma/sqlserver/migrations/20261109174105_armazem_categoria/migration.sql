BEGIN TRY

BEGIN TRAN;

-- DropForeignKey
ALTER TABLE [dbo].[product_categories] DROP CONSTRAINT [product_categories_printerId_fkey];

-- AlterTable
ALTER TABLE [dbo].[product_categories] ADD [warehouseId] INT;

-- AddForeignKey
ALTER TABLE [dbo].[product_categories] ADD CONSTRAINT [product_categories_printerId_fkey] FOREIGN KEY ([printerId]) REFERENCES [dbo].[printers]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[product_categories] ADD CONSTRAINT [product_categories_warehouseId_fkey] FOREIGN KEY ([warehouseId]) REFERENCES [dbo].[warehouses]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

