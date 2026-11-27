BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[invoices] ADD [dueDate] DATE,
[notes] NVARCHAR(1000);

-- CreateTable
CREATE TABLE [dbo].[quotes] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [year] INT NOT NULL,
    [number] INT NOT NULL,
    [fullNumber] NVARCHAR(40) NOT NULL,
    [status] NVARCHAR(40) NOT NULL CONSTRAINT [quotes_status_df] DEFAULT 'OPEN',
    [issuedAt] DATETIME2 NOT NULL CONSTRAINT [quotes_issuedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [validUntil] DATE NOT NULL,
    [customerName] NVARCHAR(200) NOT NULL,
    [customerTaxId] NVARCHAR(30),
    [customerAddress] NVARCHAR(255),
    [customerEmail] NVARCHAR(150),
    [notes] NVARCHAR(1000),
    [currency] NVARCHAR(3) NOT NULL,
    [netTotal] DECIMAL(12,2) NOT NULL,
    [taxTotal] DECIMAL(12,2) NOT NULL,
    [grossTotal] DECIMAL(12,2) NOT NULL,
    [invoiceId] INT,
    [cancelReason] NVARCHAR(255),
    [createdById] INT,
    CONSTRAINT [quotes_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [quotes_hotelId_year_number_key] UNIQUE NONCLUSTERED ([hotelId],[year],[number])
);

-- CreateTable
CREATE TABLE [dbo].[quote_lines] (
    [id] INT NOT NULL IDENTITY(1,1),
    [quoteId] INT NOT NULL,
    [position] INT NOT NULL,
    [productId] INT,
    [productCode] NVARCHAR(60),
    [description] NVARCHAR(200) NOT NULL,
    [quantity] DECIMAL(10,3) NOT NULL,
    [unitPrice] DECIMAL(12,2) NOT NULL,
    [discount] DECIMAL(12,2) NOT NULL CONSTRAINT [quote_lines_discount_df] DEFAULT 0,
    [taxRateId] INT,
    [taxRate] DECIMAL(5,2) NOT NULL,
    [netAmount] DECIMAL(12,2) NOT NULL,
    [taxAmount] DECIMAL(12,2) NOT NULL,
    [grossAmount] DECIMAL(12,2) NOT NULL,
    CONSTRAINT [quote_lines_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [quotes_hotelId_issuedAt_idx] ON [dbo].[quotes]([hotelId], [issuedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [quote_lines_quoteId_idx] ON [dbo].[quote_lines]([quoteId]);

-- AddForeignKey
ALTER TABLE [dbo].[quotes] ADD CONSTRAINT [quotes_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[quotes] ADD CONSTRAINT [quotes_invoiceId_fkey] FOREIGN KEY ([invoiceId]) REFERENCES [dbo].[invoices]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[quotes] ADD CONSTRAINT [quotes_createdById_fkey] FOREIGN KEY ([createdById]) REFERENCES [dbo].[users]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[quote_lines] ADD CONSTRAINT [quote_lines_quoteId_fkey] FOREIGN KEY ([quoteId]) REFERENCES [dbo].[quotes]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[quote_lines] ADD CONSTRAINT [quote_lines_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[products]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[quote_lines] ADD CONSTRAINT [quote_lines_taxRateId_fkey] FOREIGN KEY ([taxRateId]) REFERENCES [dbo].[tax_rates]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- CreateIndex (unicos que aceitam varios NULL, como no MySQL)
CREATE UNIQUE NONCLUSTERED INDEX [quotes_invoiceId_key] ON [dbo].[quotes]([invoiceId]) WHERE [invoiceId] IS NOT NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

