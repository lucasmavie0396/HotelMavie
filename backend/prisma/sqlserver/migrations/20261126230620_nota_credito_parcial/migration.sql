BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[invoice_lines] ADD [creditOfLineId] INT;

-- CreateIndex
CREATE NONCLUSTERED INDEX [invoice_lines_creditOfLineId_idx] ON [dbo].[invoice_lines]([creditOfLineId]);

-- AddForeignKey
ALTER TABLE [dbo].[invoice_lines] ADD CONSTRAINT [invoice_lines_creditOfLineId_fkey] FOREIGN KEY ([creditOfLineId]) REFERENCES [dbo].[invoice_lines]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

