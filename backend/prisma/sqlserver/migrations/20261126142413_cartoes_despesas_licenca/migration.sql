BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[hotels] ADD [licenseGraceUntil] DATETIME2,
[licenseLastSeenAt] DATETIME2,
[licenseText] NVARCHAR(max),
[licenseUnlocks] NVARCHAR(max),
[productionSince] DATETIME2;

-- AlterTable
ALTER TABLE [dbo].[payment_types] ADD [isEventCard] BIT NOT NULL CONSTRAINT [payment_types_isEventCard_df] DEFAULT 0;

-- CreateTable
CREATE TABLE [dbo].[event_cards] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [number] NVARCHAR(40) NOT NULL,
    [holder] NVARCHAR(120),
    [guestId] INT,
    [balance] DECIMAL(12,2) NOT NULL CONSTRAINT [event_cards_balance_df] DEFAULT 0,
    [active] BIT NOT NULL CONSTRAINT [event_cards_active_df] DEFAULT 1,
    [createdById] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [event_cards_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [event_cards_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [event_cards_hotelId_number_key] UNIQUE NONCLUSTERED ([hotelId],[number])
);

-- CreateTable
CREATE TABLE [dbo].[event_card_movements] (
    [id] INT NOT NULL IDENTITY(1,1),
    [cardId] INT NOT NULL,
    [guestId] INT,
    [type] NVARCHAR(40) NOT NULL,
    [amount] DECIMAL(12,2) NOT NULL,
    [balanceAfter] DECIMAL(12,2) NOT NULL,
    [loadPaymentId] INT,
    [usePaymentId] INT,
    [orderId] INT,
    [dischargeId] INT,
    [cashSessionId] INT,
    [reason] NVARCHAR(200),
    [idempotencyKey] NVARCHAR(80),
    [createdById] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [event_card_movements_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [event_card_movements_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[event_card_discharges] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [refunded] BIT NOT NULL,
    [paymentTypeId] INT,
    [cashSessionId] INT,
    [reference] NVARCHAR(100),
    [reason] NVARCHAR(200) NOT NULL,
    [total] DECIMAL(12,2) NOT NULL,
    [cards] INT NOT NULL,
    [createdById] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [event_card_discharges_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [event_card_discharges_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[expense_categories] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [name] NVARCHAR(80) NOT NULL,
    [active] BIT NOT NULL CONSTRAINT [expense_categories_active_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [expense_categories_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [expense_categories_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [expense_categories_hotelId_name_key] UNIQUE NONCLUSTERED ([hotelId],[name])
);

-- CreateTable
CREATE TABLE [dbo].[expenses] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [categoryId] INT NOT NULL,
    [description] NVARCHAR(200) NOT NULL,
    [amount] DECIMAL(12,2) NOT NULL,
    [date] DATE NOT NULL,
    [supplierId] INT,
    [documentRef] NVARCHAR(60),
    [paymentTypeId] INT,
    [cashSessionId] INT,
    [cashMovementId] INT,
    [status] NVARCHAR(40) NOT NULL CONSTRAINT [expenses_status_df] DEFAULT 'CONFIRMED',
    [voidReason] NVARCHAR(200),
    [voidedAt] DATETIME2,
    [voidedById] INT,
    [createdById] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [expenses_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [expenses_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[product_option_groups] (
    [id] INT NOT NULL IDENTITY(1,1),
    [productId] INT NOT NULL,
    [name] NVARCHAR(60) NOT NULL,
    [required] BIT NOT NULL CONSTRAINT [product_option_groups_required_df] DEFAULT 1,
    [maxChoices] INT NOT NULL CONSTRAINT [product_option_groups_maxChoices_df] DEFAULT 1,
    [sortOrder] INT NOT NULL CONSTRAINT [product_option_groups_sortOrder_df] DEFAULT 0,
    [active] BIT NOT NULL CONSTRAINT [product_option_groups_active_df] DEFAULT 1,
    CONSTRAINT [product_option_groups_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[product_options] (
    [id] INT NOT NULL IDENTITY(1,1),
    [groupId] INT NOT NULL,
    [name] NVARCHAR(60) NOT NULL,
    [priceDelta] DECIMAL(12,2) NOT NULL CONSTRAINT [product_options_priceDelta_df] DEFAULT 0,
    [ingredientId] INT,
    [quantity] DECIMAL(12,3) NOT NULL CONSTRAINT [product_options_quantity_df] DEFAULT 0,
    [sortOrder] INT NOT NULL CONSTRAINT [product_options_sortOrder_df] DEFAULT 0,
    [active] BIT NOT NULL CONSTRAINT [product_options_active_df] DEFAULT 1,
    CONSTRAINT [product_options_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[order_item_options] (
    [id] INT NOT NULL IDENTITY(1,1),
    [orderItemId] INT NOT NULL,
    [optionId] INT,
    [groupName] NVARCHAR(60) NOT NULL,
    [name] NVARCHAR(60) NOT NULL,
    [priceDelta] DECIMAL(12,2) NOT NULL CONSTRAINT [order_item_options_priceDelta_df] DEFAULT 0,
    [ingredientId] INT,
    [quantity] DECIMAL(12,3) NOT NULL CONSTRAINT [order_item_options_quantity_df] DEFAULT 0,
    CONSTRAINT [order_item_options_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [event_cards_guestId_idx] ON [dbo].[event_cards]([guestId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [event_card_movements_cardId_createdAt_idx] ON [dbo].[event_card_movements]([cardId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [event_card_movements_guestId_idx] ON [dbo].[event_card_movements]([guestId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [event_card_discharges_hotelId_createdAt_idx] ON [dbo].[event_card_discharges]([hotelId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [expenses_hotelId_date_idx] ON [dbo].[expenses]([hotelId], [date]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [product_option_groups_productId_idx] ON [dbo].[product_option_groups]([productId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [product_options_groupId_idx] ON [dbo].[product_options]([groupId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [order_item_options_orderItemId_idx] ON [dbo].[order_item_options]([orderItemId]);

-- AddForeignKey
ALTER TABLE [dbo].[event_cards] ADD CONSTRAINT [event_cards_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[event_cards] ADD CONSTRAINT [event_cards_guestId_fkey] FOREIGN KEY ([guestId]) REFERENCES [dbo].[guests]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[event_card_movements] ADD CONSTRAINT [event_card_movements_cardId_fkey] FOREIGN KEY ([cardId]) REFERENCES [dbo].[event_cards]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[event_card_movements] ADD CONSTRAINT [event_card_movements_loadPaymentId_fkey] FOREIGN KEY ([loadPaymentId]) REFERENCES [dbo].[payments]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[event_card_movements] ADD CONSTRAINT [event_card_movements_usePaymentId_fkey] FOREIGN KEY ([usePaymentId]) REFERENCES [dbo].[payments]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[event_card_movements] ADD CONSTRAINT [event_card_movements_dischargeId_fkey] FOREIGN KEY ([dischargeId]) REFERENCES [dbo].[event_card_discharges]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[event_card_movements] ADD CONSTRAINT [event_card_movements_createdById_fkey] FOREIGN KEY ([createdById]) REFERENCES [dbo].[users]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[event_card_discharges] ADD CONSTRAINT [event_card_discharges_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[event_card_discharges] ADD CONSTRAINT [event_card_discharges_createdById_fkey] FOREIGN KEY ([createdById]) REFERENCES [dbo].[users]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[expense_categories] ADD CONSTRAINT [expense_categories_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[expenses] ADD CONSTRAINT [expenses_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[expenses] ADD CONSTRAINT [expenses_categoryId_fkey] FOREIGN KEY ([categoryId]) REFERENCES [dbo].[expense_categories]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[expenses] ADD CONSTRAINT [expenses_supplierId_fkey] FOREIGN KEY ([supplierId]) REFERENCES [dbo].[suppliers]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[expenses] ADD CONSTRAINT [expenses_paymentTypeId_fkey] FOREIGN KEY ([paymentTypeId]) REFERENCES [dbo].[payment_types]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[expenses] ADD CONSTRAINT [expenses_createdById_fkey] FOREIGN KEY ([createdById]) REFERENCES [dbo].[users]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[product_option_groups] ADD CONSTRAINT [product_option_groups_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[products]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[product_options] ADD CONSTRAINT [product_options_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[product_option_groups]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[product_options] ADD CONSTRAINT [product_options_ingredientId_fkey] FOREIGN KEY ([ingredientId]) REFERENCES [dbo].[products]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[order_item_options] ADD CONSTRAINT [order_item_options_orderItemId_fkey] FOREIGN KEY ([orderItemId]) REFERENCES [dbo].[order_items]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[order_item_options] ADD CONSTRAINT [order_item_options_optionId_fkey] FOREIGN KEY ([optionId]) REFERENCES [dbo].[product_options]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- CreateIndex (unicos que aceitam varios NULL, como no MySQL)
CREATE UNIQUE NONCLUSTERED INDEX [event_card_movements_loadPaymentId_key] ON [dbo].[event_card_movements]([loadPaymentId]) WHERE [loadPaymentId] IS NOT NULL;
CREATE UNIQUE NONCLUSTERED INDEX [event_card_movements_usePaymentId_key] ON [dbo].[event_card_movements]([usePaymentId]) WHERE [usePaymentId] IS NOT NULL;
CREATE UNIQUE NONCLUSTERED INDEX [event_card_movements_idempotencyKey_key] ON [dbo].[event_card_movements]([idempotencyKey]) WHERE [idempotencyKey] IS NOT NULL;

EXEC('UPDATE [dbo].[hotels] SET [productionSince] = SYSUTCDATETIME(), [licenseGraceUntil] = DATEADD(day, 30, SYSUTCDATETIME())');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

