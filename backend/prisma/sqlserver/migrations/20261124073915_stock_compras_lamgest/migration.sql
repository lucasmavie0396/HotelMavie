BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[hotels] ADD [allowNegativeStock] BIT NOT NULL CONSTRAINT [hotels_allowNegativeStock_df] DEFAULT 0;

-- AlterTable
ALTER TABLE [dbo].[products] ADD [allowNegativeStock] BIT NOT NULL CONSTRAINT [products_allowNegativeStock_df] DEFAULT 0;

-- AlterTable
ALTER TABLE [dbo].[purchases] ADD [cancelReason] NVARCHAR(200),
[cancelledAt] DATETIME2,
[cancelledById] INT,
[discount] DECIMAL(12,2) NOT NULL CONSTRAINT [purchases_discount_df] DEFAULT 0,
[documentDate] DATE,
[dueDate] DATE,
[subtotal] DECIMAL(12,2) NOT NULL CONSTRAINT [purchases_subtotal_df] DEFAULT 0,
[taxTotal] DECIMAL(12,2) NOT NULL CONSTRAINT [purchases_taxTotal_df] DEFAULT 0;

-- AlterTable
ALTER TABLE [dbo].[purchase_items] ADD [discount] DECIMAL(12,2) NOT NULL CONSTRAINT [purchase_items_discount_df] DEFAULT 0,
[taxAmount] DECIMAL(12,2) NOT NULL CONSTRAINT [purchase_items_taxAmount_df] DEFAULT 0,
[taxRate] DECIMAL(5,2) NOT NULL CONSTRAINT [purchase_items_taxRate_df] DEFAULT 0;

-- AddForeignKey
ALTER TABLE [dbo].[purchases] ADD CONSTRAINT [purchases_cancelledById_fkey] FOREIGN KEY ([cancelledById]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

EXEC('UPDATE [dbo].[hotels] SET [allowNegativeStock] = 1');

EXEC('UPDATE [dbo].[purchases] SET [subtotal] = [total]');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

