BEGIN TRY

BEGIN TRAN;

-- CreateSchema
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'dbo') EXEC sp_executesql N'CREATE SCHEMA [dbo];';

-- CreateTable
CREATE TABLE [dbo].[hotels] (
    [id] INT NOT NULL IDENTITY(1,1),
    [name] NVARCHAR(150) NOT NULL,
    [publicSlug] NVARCHAR(100),
    [publicEnabled] BIT NOT NULL CONSTRAINT [hotels_publicEnabled_df] DEFAULT 0,
    [customDomain] NVARCHAR(253),
    [email] NVARCHAR(150),
    [phone] NVARCHAR(30),
    [address] NVARCHAR(255),
    [currency] NVARCHAR(3) NOT NULL CONSTRAINT [hotels_currency_df] DEFAULT 'EUR',
    [city] NVARCHAR(100),
    [postalCode] NVARCHAR(20),
    [country] NVARCHAR(2) NOT NULL CONSTRAINT [hotels_country_df] DEFAULT 'PT',
    [legalName] NVARCHAR(200),
    [taxId] NVARCHAR(30),
    [invoiceFooter] NVARCHAR(max),
    [ticketFooter] NVARCHAR(255),
    [logoFile] NVARCHAR(100),
    [publicDescription] NVARCHAR(max),
    [publicDescriptionEn] NVARCHAR(max),
    [depositPercent] DECIMAL(5,2) NOT NULL CONSTRAINT [hotels_depositPercent_df] DEFAULT 60,
    [paymentInstructions] NVARCHAR(max),
    [paymentInstructionsEn] NVARCHAR(max),
    [accommodationTaxRateId] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [hotels_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [hotels_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[users] (
    [id] INT NOT NULL IDENTITY(1,1),
    [name] NVARCHAR(150) NOT NULL,
    [email] NVARCHAR(150) NOT NULL,
    [passwordHash] NVARCHAR(255) NOT NULL,
    [role] NVARCHAR(40) NOT NULL CONSTRAINT [users_role_df] DEFAULT 'RECEPTION',
    [active] BIT NOT NULL CONSTRAINT [users_active_df] DEFAULT 1,
    [hotelId] INT,
    [totpSecret] NVARCHAR(255),
    [totpEnabled] BIT NOT NULL CONSTRAINT [users_totpEnabled_df] DEFAULT 0,
    [totpLastStep] INT,
    [totpRecoveryCodes] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [users_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [users_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [users_email_key] UNIQUE NONCLUSTERED ([email])
);

-- CreateTable
CREATE TABLE [dbo].[password_resets] (
    [id] INT NOT NULL IDENTITY(1,1),
    [userId] INT NOT NULL,
    [tokenHash] NVARCHAR(64) NOT NULL,
    [expiresAt] DATETIME2 NOT NULL,
    [usedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [password_resets_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [password_resets_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [password_resets_tokenHash_key] UNIQUE NONCLUSTERED ([tokenHash])
);

-- CreateTable
CREATE TABLE [dbo].[audit_logs] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT,
    [userId] INT,
    [action] NVARCHAR(60) NOT NULL,
    [entity] NVARCHAR(40) NOT NULL,
    [entityId] INT,
    [summary] NVARCHAR(255) NOT NULL,
    [data] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [audit_logs_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [audit_logs_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[rooms] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [number] NVARCHAR(20) NOT NULL,
    [type] NVARCHAR(60) NOT NULL,
    [capacity] INT NOT NULL CONSTRAINT [rooms_capacity_df] DEFAULT 2,
    [pricePerNight] DECIMAL(10,2) NOT NULL,
    [status] NVARCHAR(40) NOT NULL CONSTRAINT [rooms_status_df] DEFAULT 'AVAILABLE',
    [floor] INT,
    [description] NVARCHAR(max),
    [descriptionEn] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [rooms_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [rooms_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [rooms_hotelId_number_key] UNIQUE NONCLUSTERED ([hotelId],[number])
);

-- CreateTable
CREATE TABLE [dbo].[room_images] (
    [id] INT NOT NULL IDENTITY(1,1),
    [roomId] INT NOT NULL,
    [file] NVARCHAR(100) NOT NULL,
    [sortOrder] INT NOT NULL CONSTRAINT [room_images_sortOrder_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [room_images_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [room_images_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[guests] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [firstName] NVARCHAR(100) NOT NULL,
    [lastName] NVARCHAR(100) NOT NULL,
    [email] NVARCHAR(150),
    [phone] NVARCHAR(30),
    [documentType] NVARCHAR(30),
    [documentNumber] NVARCHAR(50),
    [nationality] NVARCHAR(60),
    [birthDate] DATE,
    [address] NVARCHAR(255),
    [taxId] NVARCHAR(30),
    [notes] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [guests_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [guests_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[reservation_groups] (
    [id] INT NOT NULL IDENTITY(1,1),
    [code] NVARCHAR(20) NOT NULL,
    [hotelId] INT NOT NULL,
    [kind] NVARCHAR(40) NOT NULL CONSTRAINT [reservation_groups_kind_df] DEFAULT 'INDIVIDUAL',
    [companyName] NVARCHAR(200),
    [companyTaxId] NVARCHAR(30),
    [companyAddress] NVARCHAR(255),
    [companyEmail] NVARCHAR(150),
    [companyPhone] NVARCHAR(30),
    [contactName] NVARCHAR(150),
    [notes] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [reservation_groups_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [reservation_groups_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [reservation_groups_code_key] UNIQUE NONCLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[reservations] (
    [id] INT NOT NULL IDENTITY(1,1),
    [code] NVARCHAR(20) NOT NULL,
    [hotelId] INT NOT NULL,
    [groupId] INT,
    [guestId] INT NOT NULL,
    [roomId] INT NOT NULL,
    [checkIn] DATE NOT NULL,
    [checkOut] DATE NOT NULL,
    [adults] INT NOT NULL CONSTRAINT [reservations_adults_df] DEFAULT 1,
    [children] INT NOT NULL CONSTRAINT [reservations_children_df] DEFAULT 0,
    [status] NVARCHAR(40) NOT NULL CONSTRAINT [reservations_status_df] DEFAULT 'PENDING',
    [source] NVARCHAR(40) NOT NULL CONSTRAINT [reservations_source_df] DEFAULT 'DESK',
    [pricePerNight] DECIMAL(10,2) NOT NULL,
    [totalAmount] DECIMAL(12,2) NOT NULL,
    [notes] NVARCHAR(max),
    [locale] NVARCHAR(5) NOT NULL CONSTRAINT [reservations_locale_df] DEFAULT 'pt',
    [checkedInAt] DATETIME2,
    [checkedOutAt] DATETIME2,
    [cancelledAt] DATETIME2,
    [depositAmount] DECIMAL(12,2),
    [depositReference] NVARCHAR(100),
    [depositPaymentTypeId] INT,
    [depositPaymentId] INT,
    [depositConfirmedAt] DATETIME2,
    [depositConfirmedById] INT,
    [createdById] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [reservations_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [reservations_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [reservations_code_key] UNIQUE NONCLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[reservation_companions] (
    [id] INT NOT NULL IDENTITY(1,1),
    [reservationId] INT NOT NULL,
    [firstName] NVARCHAR(100) NOT NULL,
    [lastName] NVARCHAR(100) NOT NULL,
    [isChild] BIT NOT NULL CONSTRAINT [reservation_companions_isChild_df] DEFAULT 0,
    [birthDate] DATE,
    [nationality] NVARCHAR(60),
    [documentType] NVARCHAR(30),
    [documentNumber] NVARCHAR(50),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [reservation_companions_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [reservation_companions_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[tax_rates] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [name] NVARCHAR(60) NOT NULL,
    [rate] DECIMAL(5,2) NOT NULL,
    [atCategory] NVARCHAR(40) NOT NULL CONSTRAINT [tax_rates_atCategory_df] DEFAULT 'NOR',
    [exemptionCode] NVARCHAR(3),
    [exemptionReason] NVARCHAR(255),
    [active] BIT NOT NULL CONSTRAINT [tax_rates_active_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [tax_rates_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [tax_rates_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[charges] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [reservationId] INT,
    [type] NVARCHAR(40) NOT NULL CONSTRAINT [charges_type_df] DEFAULT 'EXTRA',
    [description] NVARCHAR(200) NOT NULL,
    [quantity] DECIMAL(10,3) NOT NULL,
    [unitPrice] DECIMAL(12,2) NOT NULL,
    [taxRateId] INT,
    [taxRate] DECIMAL(5,2) NOT NULL,
    [total] DECIMAL(12,2) NOT NULL,
    [invoiceId] INT,
    [sourceRef] NVARCHAR(60),
    [productCode] NVARCHAR(60),
    [orderId] INT,
    [createdById] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [charges_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [charges_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[payments] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [reservationId] INT,
    [invoiceId] INT,
    [cashSessionId] INT,
    [receiptId] INT,
    [orderId] INT,
    [amount] DECIMAL(12,2) NOT NULL,
    [method] NVARCHAR(40) NOT NULL,
    [paymentTypeId] INT,
    [reference] NVARCHAR(100),
    [notes] NVARCHAR(255),
    [createdById] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [payments_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [payments_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[invoice_series] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [type] NVARCHAR(40) NOT NULL,
    [code] NVARCHAR(20) NOT NULL,
    [nextNumber] INT NOT NULL CONSTRAINT [invoice_series_nextNumber_df] DEFAULT 1,
    [atValidationCode] NVARCHAR(20),
    [lastHash] NVARCHAR(255),
    [active] BIT NOT NULL CONSTRAINT [invoice_series_active_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [invoice_series_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [invoice_series_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [invoice_series_hotelId_type_code_key] UNIQUE NONCLUSTERED ([hotelId],[type],[code])
);

-- CreateTable
CREATE TABLE [dbo].[invoices] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [seriesId] INT NOT NULL,
    [type] NVARCHAR(40) NOT NULL,
    [number] INT NOT NULL,
    [fullNumber] NVARCHAR(40) NOT NULL,
    [status] NVARCHAR(40) NOT NULL CONSTRAINT [invoices_status_df] DEFAULT 'ISSUED',
    [issuedAt] DATETIME2 NOT NULL CONSTRAINT [invoices_issuedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [reservationId] INT,
    [creditOfId] INT,
    [reason] NVARCHAR(255),
    [customerName] NVARCHAR(200) NOT NULL,
    [customerTaxId] NVARCHAR(30),
    [customerAddress] NVARCHAR(255),
    [customerEmail] NVARCHAR(150),
    [currency] NVARCHAR(3) NOT NULL,
    [netTotal] DECIMAL(12,2) NOT NULL,
    [taxTotal] DECIMAL(12,2) NOT NULL,
    [grossTotal] DECIMAL(12,2) NOT NULL,
    [previousHash] NVARCHAR(255),
    [hash] NVARCHAR(255) NOT NULL,
    [atcud] NVARCHAR(80),
    [keyVersion] INT NOT NULL CONSTRAINT [invoices_keyVersion_df] DEFAULT 1,
    [createdById] INT,
    CONSTRAINT [invoices_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [invoices_seriesId_number_key] UNIQUE NONCLUSTERED ([seriesId],[number])
);

-- CreateTable
CREATE TABLE [dbo].[invoice_lines] (
    [id] INT NOT NULL IDENTITY(1,1),
    [invoiceId] INT NOT NULL,
    [description] NVARCHAR(200) NOT NULL,
    [quantity] DECIMAL(10,3) NOT NULL,
    [unitPrice] DECIMAL(12,2) NOT NULL,
    [taxRate] DECIMAL(5,2) NOT NULL,
    [productCode] NVARCHAR(60) NOT NULL CONSTRAINT [invoice_lines_productCode_df] DEFAULT 'GERAL',
    [taxCategory] NVARCHAR(40) NOT NULL CONSTRAINT [invoice_lines_taxCategory_df] DEFAULT 'NOR',
    [exemptionCode] NVARCHAR(3),
    [exemptionReason] NVARCHAR(255),
    [netAmount] DECIMAL(12,2) NOT NULL,
    [taxAmount] DECIMAL(12,2) NOT NULL,
    [grossAmount] DECIMAL(12,2) NOT NULL,
    CONSTRAINT [invoice_lines_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[cash_registers] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [name] NVARCHAR(60) NOT NULL,
    [active] BIT NOT NULL CONSTRAINT [cash_registers_active_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [cash_registers_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [cash_registers_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [cash_registers_hotelId_name_key] UNIQUE NONCLUSTERED ([hotelId],[name])
);

-- CreateTable
CREATE TABLE [dbo].[cash_sessions] (
    [id] INT NOT NULL IDENTITY(1,1),
    [registerId] INT NOT NULL,
    [openedById] INT,
    [openedAt] DATETIME2 NOT NULL CONSTRAINT [cash_sessions_openedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [openingAmount] DECIMAL(12,2) NOT NULL,
    [closedById] INT,
    [closedAt] DATETIME2,
    [expectedAmount] DECIMAL(12,2),
    [countedAmount] DECIMAL(12,2),
    [difference] DECIMAL(12,2),
    [notes] NVARCHAR(max),
    CONSTRAINT [cash_sessions_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[cash_movements] (
    [id] INT NOT NULL IDENTITY(1,1),
    [sessionId] INT NOT NULL,
    [type] NVARCHAR(40) NOT NULL,
    [amount] DECIMAL(12,2) NOT NULL,
    [description] NVARCHAR(200) NOT NULL,
    [createdById] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [cash_movements_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [cash_movements_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[product_categories] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [name] NVARCHAR(80) NOT NULL,
    [outlet] NVARCHAR(40),
    [prepStation] NVARCHAR(40) NOT NULL CONSTRAINT [product_categories_prepStation_df] DEFAULT 'KITCHEN',
    [printerId] INT,
    [sortOrder] INT NOT NULL CONSTRAINT [product_categories_sortOrder_df] DEFAULT 0,
    CONSTRAINT [product_categories_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [product_categories_hotelId_name_key] UNIQUE NONCLUSTERED ([hotelId],[name])
);

-- CreateTable
CREATE TABLE [dbo].[products] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [categoryId] INT,
    [name] NVARCHAR(120) NOT NULL,
    [sku] NVARCHAR(40),
    [unit] NVARCHAR(10) NOT NULL CONSTRAINT [products_unit_df] DEFAULT 'un',
    [price] DECIMAL(12,2) NOT NULL CONSTRAINT [products_price_df] DEFAULT 0,
    [cost] DECIMAL(12,4) NOT NULL CONSTRAINT [products_cost_df] DEFAULT 0,
    [taxRateId] INT,
    [sellable] BIT NOT NULL CONSTRAINT [products_sellable_df] DEFAULT 1,
    [trackStock] BIT NOT NULL CONSTRAINT [products_trackStock_df] DEFAULT 0,
    [trackExpiry] BIT NOT NULL CONSTRAINT [products_trackExpiry_df] DEFAULT 0,
    [minStock] DECIMAL(12,3) NOT NULL CONSTRAINT [products_minStock_df] DEFAULT 0,
    [imageFile] NVARCHAR(100),
    [active] BIT NOT NULL CONSTRAINT [products_active_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [products_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [products_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[orders] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [outlet] NVARCHAR(40) NOT NULL,
    [tableLabel] NVARCHAR(30),
    [tableId] INT,
    [status] NVARCHAR(40) NOT NULL CONSTRAINT [orders_status_df] DEFAULT 'OPEN',
    [reservationId] INT,
    [total] DECIMAL(12,2) NOT NULL CONSTRAINT [orders_total_df] DEFAULT 0,
    [notes] NVARCHAR(255),
    [openedById] INT,
    [openedAt] DATETIME2 NOT NULL CONSTRAINT [orders_openedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [closedAt] DATETIME2,
    CONSTRAINT [orders_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[dining_tables] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [outlet] NVARCHAR(40) NOT NULL,
    [number] INT NOT NULL,
    [name] NVARCHAR(40),
    [seats] INT NOT NULL CONSTRAINT [dining_tables_seats_df] DEFAULT 4,
    [active] BIT NOT NULL CONSTRAINT [dining_tables_active_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [dining_tables_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [dining_tables_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [dining_tables_hotelId_outlet_number_key] UNIQUE NONCLUSTERED ([hotelId],[outlet],[number])
);

-- CreateTable
CREATE TABLE [dbo].[order_items] (
    [id] INT NOT NULL IDENTITY(1,1),
    [orderId] INT NOT NULL,
    [productId] INT NOT NULL,
    [description] NVARCHAR(120) NOT NULL,
    [quantity] DECIMAL(10,3) NOT NULL,
    [unitPrice] DECIMAL(12,2) NOT NULL,
    [taxRateId] INT,
    [total] DECIMAL(12,2) NOT NULL,
    [notes] NVARCHAR(255),
    [sentAt] DATETIME2,
    [readyAt] DATETIME2,
    [voidedAt] DATETIME2,
    [voidReason] NVARCHAR(200),
    [voidedById] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [order_items_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [order_items_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[suppliers] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [name] NVARCHAR(150) NOT NULL,
    [taxId] NVARCHAR(30),
    [email] NVARCHAR(150),
    [phone] NVARCHAR(30),
    [address] NVARCHAR(255),
    [notes] NVARCHAR(max),
    [active] BIT NOT NULL CONSTRAINT [suppliers_active_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [suppliers_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [suppliers_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[warehouses] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [name] NVARCHAR(80) NOT NULL,
    [isDefault] BIT NOT NULL CONSTRAINT [warehouses_isDefault_df] DEFAULT 0,
    [active] BIT NOT NULL CONSTRAINT [warehouses_active_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [warehouses_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [warehouses_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [warehouses_hotelId_name_key] UNIQUE NONCLUSTERED ([hotelId],[name])
);

-- CreateTable
CREATE TABLE [dbo].[stock_levels] (
    [id] INT NOT NULL IDENTITY(1,1),
    [warehouseId] INT NOT NULL,
    [productId] INT NOT NULL,
    [quantity] DECIMAL(12,3) NOT NULL CONSTRAINT [stock_levels_quantity_df] DEFAULT 0,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [stock_levels_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [stock_levels_warehouseId_productId_key] UNIQUE NONCLUSTERED ([warehouseId],[productId])
);

-- CreateTable
CREATE TABLE [dbo].[stock_movements] (
    [id] INT NOT NULL IDENTITY(1,1),
    [warehouseId] INT NOT NULL,
    [productId] INT NOT NULL,
    [type] NVARCHAR(40) NOT NULL,
    [quantity] DECIMAL(12,3) NOT NULL,
    [unitCost] DECIMAL(12,4),
    [balance] DECIMAL(12,3) NOT NULL,
    [reason] NVARCHAR(200),
    [orderId] INT,
    [purchaseId] INT,
    [documentId] INT,
    [createdById] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [stock_movements_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [stock_movements_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[purchases] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [supplierId] INT NOT NULL,
    [warehouseId] INT NOT NULL,
    [status] NVARCHAR(40) NOT NULL CONSTRAINT [purchases_status_df] DEFAULT 'DRAFT',
    [supplierRef] NVARCHAR(60),
    [total] DECIMAL(12,2) NOT NULL CONSTRAINT [purchases_total_df] DEFAULT 0,
    [notes] NVARCHAR(max),
    [orderedAt] DATETIME2 NOT NULL CONSTRAINT [purchases_orderedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [sentAt] DATETIME2,
    [receivedAt] DATETIME2,
    [createdById] INT,
    CONSTRAINT [purchases_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[purchase_items] (
    [id] INT NOT NULL IDENTITY(1,1),
    [purchaseId] INT NOT NULL,
    [productId] INT NOT NULL,
    [quantity] DECIMAL(12,3) NOT NULL,
    [receivedQuantity] DECIMAL(12,3) NOT NULL CONSTRAINT [purchase_items_receivedQuantity_df] DEFAULT 0,
    [unitCost] DECIMAL(12,4) NOT NULL,
    [total] DECIMAL(12,2) NOT NULL,
    CONSTRAINT [purchase_items_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[stock_documents] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [type] NVARCHAR(40) NOT NULL,
    [status] NVARCHAR(40) NOT NULL CONSTRAINT [stock_documents_status_df] DEFAULT 'DRAFT',
    [year] INT,
    [number] INT,
    [warehouseId] INT NOT NULL,
    [toWarehouseId] INT,
    [supplierId] INT,
    [reason] NVARCHAR(200),
    [createdById] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [stock_documents_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [postedAt] DATETIME2,
    CONSTRAINT [stock_documents_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[stock_document_series] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [type] NVARCHAR(40) NOT NULL,
    [year] INT NOT NULL,
    [nextNumber] INT NOT NULL CONSTRAINT [stock_document_series_nextNumber_df] DEFAULT 1,
    CONSTRAINT [stock_document_series_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [stock_document_series_hotelId_type_year_key] UNIQUE NONCLUSTERED ([hotelId],[type],[year])
);

-- CreateTable
CREATE TABLE [dbo].[stock_lots] (
    [id] INT NOT NULL IDENTITY(1,1),
    [warehouseId] INT NOT NULL,
    [productId] INT NOT NULL,
    [code] NVARCHAR(40),
    [expiryDate] DATE,
    [quantity] DECIMAL(12,3) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [stock_lots_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [stock_lots_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[stock_document_items] (
    [id] INT NOT NULL IDENTITY(1,1),
    [documentId] INT NOT NULL,
    [productId] INT NOT NULL,
    [quantity] DECIMAL(12,3) NOT NULL,
    [previousQuantity] DECIMAL(12,3),
    CONSTRAINT [stock_document_items_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[user_sessions] (
    [id] INT NOT NULL IDENTITY(1,1),
    [userId] INT NOT NULL,
    [tokenHash] NVARCHAR(64) NOT NULL,
    [previousTokenHash] NVARCHAR(64),
    [rotatedAt] DATETIME2,
    [expiresAt] DATETIME2 NOT NULL,
    [userAgent] NVARCHAR(255),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [user_sessions_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [lastUsedAt] DATETIME2 NOT NULL CONSTRAINT [user_sessions_lastUsedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [user_sessions_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [user_sessions_tokenHash_key] UNIQUE NONCLUSTERED ([tokenHash])
);

-- CreateTable
CREATE TABLE [dbo].[recipe_items] (
    [id] INT NOT NULL IDENTITY(1,1),
    [productId] INT NOT NULL,
    [ingredientId] INT NOT NULL,
    [quantity] DECIMAL(12,3) NOT NULL,
    CONSTRAINT [recipe_items_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [recipe_items_productId_ingredientId_key] UNIQUE NONCLUSTERED ([productId],[ingredientId])
);

-- CreateTable
CREATE TABLE [dbo].[email_logs] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT,
    [kind] NVARCHAR(40) NOT NULL,
    [recipient] NVARCHAR(255) NOT NULL,
    [subject] NVARCHAR(255) NOT NULL,
    [status] NVARCHAR(40) NOT NULL,
    [error] NVARCHAR(max),
    [relatedId] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [email_logs_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [email_logs_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[receipts] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [seriesId] INT NOT NULL,
    [number] INT NOT NULL,
    [fullNumber] NVARCHAR(40) NOT NULL,
    [atcud] NVARCHAR(80),
    [status] NVARCHAR(40) NOT NULL CONSTRAINT [receipts_status_df] DEFAULT 'ISSUED',
    [issuedAt] DATETIME2 NOT NULL CONSTRAINT [receipts_issuedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [customerName] NVARCHAR(200) NOT NULL,
    [customerTaxId] NVARCHAR(30),
    [amount] DECIMAL(12,2) NOT NULL,
    [method] NVARCHAR(40) NOT NULL,
    [paymentTypeId] INT,
    [reference] NVARCHAR(100),
    [cancelledAt] DATETIME2,
    [cancelReason] NVARCHAR(255),
    [createdById] INT,
    CONSTRAINT [receipts_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [receipts_seriesId_number_key] UNIQUE NONCLUSTERED ([seriesId],[number])
);

-- CreateTable
CREATE TABLE [dbo].[receipt_lines] (
    [id] INT NOT NULL IDENTITY(1,1),
    [receiptId] INT NOT NULL,
    [invoiceId] INT NOT NULL,
    [amount] DECIMAL(12,2) NOT NULL,
    CONSTRAINT [receipt_lines_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[employees] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [userId] INT,
    [fullName] NVARCHAR(150) NOT NULL,
    [jobTitle] NVARCHAR(80) NOT NULL,
    [department] NVARCHAR(60),
    [email] NVARCHAR(150),
    [phone] NVARCHAR(30),
    [taxId] NVARCHAR(30),
    [socialSecurityNumber] NVARCHAR(30),
    [iban] NVARCHAR(40),
    [contractType] NVARCHAR(40) NOT NULL CONSTRAINT [employees_contractType_df] DEFAULT 'PERMANENT',
    [startDate] DATE NOT NULL,
    [endDate] DATE,
    [weeklyHours] DECIMAL(5,2) NOT NULL CONSTRAINT [employees_weeklyHours_df] DEFAULT 40,
    [baseSalary] DECIMAL(12,2),
    [irsRate] DECIMAL(5,2) NOT NULL CONSTRAINT [employees_irsRate_df] DEFAULT 0,
    [active] BIT NOT NULL CONSTRAINT [employees_active_df] DEFAULT 1,
    [notes] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [employees_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [employees_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[payroll_settings] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [employeeSsRate] DECIMAL(5,2) NOT NULL CONSTRAINT [payroll_settings_employeeSsRate_df] DEFAULT 11,
    [employerSsRate] DECIMAL(5,2) NOT NULL CONSTRAINT [payroll_settings_employerSsRate_df] DEFAULT 23.75,
    [overtimeMultiplier] DECIMAL(4,2) NOT NULL CONSTRAINT [payroll_settings_overtimeMultiplier_df] DEFAULT 1.25,
    [subsidiesInTwelfths] BIT NOT NULL CONSTRAINT [payroll_settings_subsidiesInTwelfths_df] DEFAULT 0,
    [holidayPayMonth] INT NOT NULL CONSTRAINT [payroll_settings_holidayPayMonth_df] DEFAULT 6,
    [christmasPayMonth] INT NOT NULL CONSTRAINT [payroll_settings_christmasPayMonth_df] DEFAULT 12,
    CONSTRAINT [payroll_settings_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [payroll_settings_hotelId_key] UNIQUE NONCLUSTERED ([hotelId])
);

-- CreateTable
CREATE TABLE [dbo].[payroll_runs] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [year] INT NOT NULL,
    [month] INT NOT NULL,
    [status] NVARCHAR(40) NOT NULL CONSTRAINT [payroll_runs_status_df] DEFAULT 'DRAFT',
    [createdById] INT,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [payroll_runs_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [closedAt] DATETIME2,
    CONSTRAINT [payroll_runs_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [payroll_runs_hotelId_year_month_key] UNIQUE NONCLUSTERED ([hotelId],[year],[month])
);

-- CreateTable
CREATE TABLE [dbo].[payslips] (
    [id] INT NOT NULL IDENTITY(1,1),
    [runId] INT NOT NULL,
    [employeeId] INT NOT NULL,
    [fullName] NVARCHAR(150) NOT NULL,
    [jobTitle] NVARCHAR(80) NOT NULL,
    [taxId] NVARCHAR(30),
    [socialSecurityNumber] NVARCHAR(30),
    [iban] NVARCHAR(40),
    [weeklyHours] DECIMAL(5,2) NOT NULL,
    [baseSalary] DECIMAL(12,2) NOT NULL,
    [hourlyRate] DECIMAL(12,4) NOT NULL,
    [scheduledHours] DECIMAL(8,2) NOT NULL CONSTRAINT [payslips_scheduledHours_df] DEFAULT 0,
    [workedHours] DECIMAL(8,2) NOT NULL CONSTRAINT [payslips_workedHours_df] DEFAULT 0,
    [absenceHours] DECIMAL(8,2) NOT NULL CONSTRAINT [payslips_absenceHours_df] DEFAULT 0,
    [absenceDeduction] DECIMAL(12,2) NOT NULL CONSTRAINT [payslips_absenceDeduction_df] DEFAULT 0,
    [overtimeHours] DECIMAL(8,2) NOT NULL CONSTRAINT [payslips_overtimeHours_df] DEFAULT 0,
    [overtimePay] DECIMAL(12,2) NOT NULL CONSTRAINT [payslips_overtimePay_df] DEFAULT 0,
    [holidayPay] DECIMAL(12,2) NOT NULL CONSTRAINT [payslips_holidayPay_df] DEFAULT 0,
    [christmasPay] DECIMAL(12,2) NOT NULL CONSTRAINT [payslips_christmasPay_df] DEFAULT 0,
    [otherEarnings] DECIMAL(12,2) NOT NULL CONSTRAINT [payslips_otherEarnings_df] DEFAULT 0,
    [grossPay] DECIMAL(12,2) NOT NULL CONSTRAINT [payslips_grossPay_df] DEFAULT 0,
    [ssBase] DECIMAL(12,2) NOT NULL CONSTRAINT [payslips_ssBase_df] DEFAULT 0,
    [employeeSsRate] DECIMAL(5,2) NOT NULL,
    [employeeSs] DECIMAL(12,2) NOT NULL CONSTRAINT [payslips_employeeSs_df] DEFAULT 0,
    [irsRate] DECIMAL(5,2) NOT NULL,
    [irsWithholding] DECIMAL(12,2) NOT NULL CONSTRAINT [payslips_irsWithholding_df] DEFAULT 0,
    [otherDeductions] DECIMAL(12,2) NOT NULL CONSTRAINT [payslips_otherDeductions_df] DEFAULT 0,
    [netPay] DECIMAL(12,2) NOT NULL CONSTRAINT [payslips_netPay_df] DEFAULT 0,
    [employerSsRate] DECIMAL(5,2) NOT NULL,
    [employerSs] DECIMAL(12,2) NOT NULL CONSTRAINT [payslips_employerSs_df] DEFAULT 0,
    [extraLines] NVARCHAR(max),
    [notes] NVARCHAR(255),
    [manual] BIT NOT NULL CONSTRAINT [payslips_manual_df] DEFAULT 0,
    CONSTRAINT [payslips_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [payslips_runId_employeeId_key] UNIQUE NONCLUSTERED ([runId],[employeeId])
);

-- CreateTable
CREATE TABLE [dbo].[shifts] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [employeeId] INT NOT NULL,
    [date] DATE NOT NULL,
    [startTime] NVARCHAR(5) NOT NULL,
    [endTime] NVARCHAR(5) NOT NULL,
    [breakMinutes] INT NOT NULL CONSTRAINT [shifts_breakMinutes_df] DEFAULT 0,
    [notes] NVARCHAR(200),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [shifts_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [shifts_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[time_entries] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [employeeId] INT NOT NULL,
    [clockIn] DATETIME2 NOT NULL,
    [clockOut] DATETIME2,
    [source] NVARCHAR(40) NOT NULL CONSTRAINT [time_entries_source_df] DEFAULT 'SELF',
    [notes] NVARCHAR(200),
    [editedById] INT,
    [editedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [time_entries_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [time_entries_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[printers] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [name] NVARCHAR(60) NOT NULL,
    [purpose] NVARCHAR(40) NOT NULL,
    [connection] NVARCHAR(40) NOT NULL CONSTRAINT [printers_connection_df] DEFAULT 'BROWSER',
    [host] NVARCHAR(100),
    [port] INT NOT NULL CONSTRAINT [printers_port_df] DEFAULT 9100,
    [localName] NVARCHAR(200),
    [paperWidth] NVARCHAR(40) NOT NULL CONSTRAINT [printers_paperWidth_df] DEFAULT 'MM80',
    [output] NVARCHAR(40) NOT NULL CONSTRAINT [printers_output_df] DEFAULT 'DIRECT',
    [copies] INT NOT NULL CONSTRAINT [printers_copies_df] DEFAULT 1,
    [isDefault] BIT NOT NULL CONSTRAINT [printers_isDefault_df] DEFAULT 0,
    [active] BIT NOT NULL CONSTRAINT [printers_active_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [printers_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [printers_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [printers_hotelId_name_key] UNIQUE NONCLUSTERED ([hotelId],[name])
);

-- CreateTable
CREATE TABLE [dbo].[payment_types] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [name] NVARCHAR(60) NOT NULL,
    [kind] NVARCHAR(40) NOT NULL,
    [mechanism] NVARCHAR(2),
    [requiresReference] BIT NOT NULL CONSTRAINT [payment_types_requiresReference_df] DEFAULT 0,
    [active] BIT NOT NULL CONSTRAINT [payment_types_active_df] DEFAULT 1,
    [sortOrder] INT NOT NULL CONSTRAINT [payment_types_sortOrder_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [payment_types_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [payment_types_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [payment_types_hotelId_name_key] UNIQUE NONCLUSTERED ([hotelId],[name])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [users_hotelId_idx] ON [dbo].[users]([hotelId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [password_resets_userId_idx] ON [dbo].[password_resets]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [audit_logs_hotelId_createdAt_idx] ON [dbo].[audit_logs]([hotelId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [audit_logs_action_idx] ON [dbo].[audit_logs]([action]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [room_images_roomId_idx] ON [dbo].[room_images]([roomId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [guests_hotelId_lastName_idx] ON [dbo].[guests]([hotelId], [lastName]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [guests_hotelId_email_idx] ON [dbo].[guests]([hotelId], [email]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [reservation_groups_hotelId_companyTaxId_idx] ON [dbo].[reservation_groups]([hotelId], [companyTaxId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [reservations_hotelId_checkIn_idx] ON [dbo].[reservations]([hotelId], [checkIn]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [reservations_hotelId_checkOut_idx] ON [dbo].[reservations]([hotelId], [checkOut]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [reservations_roomId_checkIn_checkOut_idx] ON [dbo].[reservations]([roomId], [checkIn], [checkOut]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [reservations_guestId_idx] ON [dbo].[reservations]([guestId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [reservations_groupId_idx] ON [dbo].[reservations]([groupId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [reservation_companions_reservationId_idx] ON [dbo].[reservation_companions]([reservationId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [tax_rates_hotelId_idx] ON [dbo].[tax_rates]([hotelId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [charges_reservationId_idx] ON [dbo].[charges]([reservationId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [charges_invoiceId_idx] ON [dbo].[charges]([invoiceId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [charges_hotelId_createdAt_idx] ON [dbo].[charges]([hotelId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [payments_reservationId_idx] ON [dbo].[payments]([reservationId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [payments_cashSessionId_idx] ON [dbo].[payments]([cashSessionId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [payments_hotelId_createdAt_idx] ON [dbo].[payments]([hotelId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [invoices_hotelId_issuedAt_idx] ON [dbo].[invoices]([hotelId], [issuedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [invoice_lines_invoiceId_idx] ON [dbo].[invoice_lines]([invoiceId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [cash_sessions_registerId_closedAt_idx] ON [dbo].[cash_sessions]([registerId], [closedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [cash_movements_sessionId_idx] ON [dbo].[cash_movements]([sessionId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [products_hotelId_categoryId_idx] ON [dbo].[products]([hotelId], [categoryId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [orders_hotelId_status_idx] ON [dbo].[orders]([hotelId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [orders_hotelId_openedAt_idx] ON [dbo].[orders]([hotelId], [openedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [orders_tableId_status_idx] ON [dbo].[orders]([tableId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [order_items_orderId_idx] ON [dbo].[order_items]([orderId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [suppliers_hotelId_idx] ON [dbo].[suppliers]([hotelId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [stock_movements_warehouseId_productId_createdAt_idx] ON [dbo].[stock_movements]([warehouseId], [productId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [purchases_hotelId_status_idx] ON [dbo].[purchases]([hotelId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [purchase_items_purchaseId_idx] ON [dbo].[purchase_items]([purchaseId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [stock_documents_hotelId_type_status_idx] ON [dbo].[stock_documents]([hotelId], [type], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [stock_documents_warehouseId_idx] ON [dbo].[stock_documents]([warehouseId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [stock_lots_warehouseId_productId_idx] ON [dbo].[stock_lots]([warehouseId], [productId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [stock_lots_expiryDate_idx] ON [dbo].[stock_lots]([expiryDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [stock_document_items_documentId_idx] ON [dbo].[stock_document_items]([documentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [user_sessions_userId_idx] ON [dbo].[user_sessions]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [user_sessions_previousTokenHash_idx] ON [dbo].[user_sessions]([previousTokenHash]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [recipe_items_ingredientId_idx] ON [dbo].[recipe_items]([ingredientId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [email_logs_hotelId_createdAt_idx] ON [dbo].[email_logs]([hotelId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [receipts_hotelId_issuedAt_idx] ON [dbo].[receipts]([hotelId], [issuedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [receipt_lines_receiptId_idx] ON [dbo].[receipt_lines]([receiptId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [receipt_lines_invoiceId_idx] ON [dbo].[receipt_lines]([invoiceId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [employees_hotelId_active_idx] ON [dbo].[employees]([hotelId], [active]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [shifts_hotelId_date_idx] ON [dbo].[shifts]([hotelId], [date]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [shifts_employeeId_date_idx] ON [dbo].[shifts]([employeeId], [date]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [time_entries_employeeId_clockIn_idx] ON [dbo].[time_entries]([employeeId], [clockIn]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [time_entries_hotelId_clockIn_idx] ON [dbo].[time_entries]([hotelId], [clockIn]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [printers_hotelId_purpose_idx] ON [dbo].[printers]([hotelId], [purpose]);

-- AddForeignKey
ALTER TABLE [dbo].[hotels] ADD CONSTRAINT [hotels_accommodationTaxRateId_fkey] FOREIGN KEY ([accommodationTaxRateId]) REFERENCES [dbo].[tax_rates]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[users] ADD CONSTRAINT [users_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[password_resets] ADD CONSTRAINT [password_resets_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[audit_logs] ADD CONSTRAINT [audit_logs_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[audit_logs] ADD CONSTRAINT [audit_logs_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[rooms] ADD CONSTRAINT [rooms_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[room_images] ADD CONSTRAINT [room_images_roomId_fkey] FOREIGN KEY ([roomId]) REFERENCES [dbo].[rooms]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[guests] ADD CONSTRAINT [guests_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[reservation_groups] ADD CONSTRAINT [reservation_groups_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[reservations] ADD CONSTRAINT [reservations_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[reservations] ADD CONSTRAINT [reservations_groupId_fkey] FOREIGN KEY ([groupId]) REFERENCES [dbo].[reservation_groups]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[reservations] ADD CONSTRAINT [reservations_guestId_fkey] FOREIGN KEY ([guestId]) REFERENCES [dbo].[guests]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[reservations] ADD CONSTRAINT [reservations_roomId_fkey] FOREIGN KEY ([roomId]) REFERENCES [dbo].[rooms]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[reservations] ADD CONSTRAINT [reservations_depositPaymentTypeId_fkey] FOREIGN KEY ([depositPaymentTypeId]) REFERENCES [dbo].[payment_types]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[reservations] ADD CONSTRAINT [reservations_depositPaymentId_fkey] FOREIGN KEY ([depositPaymentId]) REFERENCES [dbo].[payments]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[reservations] ADD CONSTRAINT [reservations_depositConfirmedById_fkey] FOREIGN KEY ([depositConfirmedById]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[reservations] ADD CONSTRAINT [reservations_createdById_fkey] FOREIGN KEY ([createdById]) REFERENCES [dbo].[users]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[reservation_companions] ADD CONSTRAINT [reservation_companions_reservationId_fkey] FOREIGN KEY ([reservationId]) REFERENCES [dbo].[reservations]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[tax_rates] ADD CONSTRAINT [tax_rates_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[charges] ADD CONSTRAINT [charges_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[charges] ADD CONSTRAINT [charges_reservationId_fkey] FOREIGN KEY ([reservationId]) REFERENCES [dbo].[reservations]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[charges] ADD CONSTRAINT [charges_taxRateId_fkey] FOREIGN KEY ([taxRateId]) REFERENCES [dbo].[tax_rates]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[charges] ADD CONSTRAINT [charges_invoiceId_fkey] FOREIGN KEY ([invoiceId]) REFERENCES [dbo].[invoices]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[charges] ADD CONSTRAINT [charges_orderId_fkey] FOREIGN KEY ([orderId]) REFERENCES [dbo].[orders]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[charges] ADD CONSTRAINT [charges_createdById_fkey] FOREIGN KEY ([createdById]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[payments] ADD CONSTRAINT [payments_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[payments] ADD CONSTRAINT [payments_reservationId_fkey] FOREIGN KEY ([reservationId]) REFERENCES [dbo].[reservations]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[payments] ADD CONSTRAINT [payments_invoiceId_fkey] FOREIGN KEY ([invoiceId]) REFERENCES [dbo].[invoices]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[payments] ADD CONSTRAINT [payments_cashSessionId_fkey] FOREIGN KEY ([cashSessionId]) REFERENCES [dbo].[cash_sessions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[payments] ADD CONSTRAINT [payments_receiptId_fkey] FOREIGN KEY ([receiptId]) REFERENCES [dbo].[receipts]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[payments] ADD CONSTRAINT [payments_orderId_fkey] FOREIGN KEY ([orderId]) REFERENCES [dbo].[orders]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[payments] ADD CONSTRAINT [payments_paymentTypeId_fkey] FOREIGN KEY ([paymentTypeId]) REFERENCES [dbo].[payment_types]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[payments] ADD CONSTRAINT [payments_createdById_fkey] FOREIGN KEY ([createdById]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[invoice_series] ADD CONSTRAINT [invoice_series_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[invoices] ADD CONSTRAINT [invoices_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[invoices] ADD CONSTRAINT [invoices_seriesId_fkey] FOREIGN KEY ([seriesId]) REFERENCES [dbo].[invoice_series]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[invoices] ADD CONSTRAINT [invoices_reservationId_fkey] FOREIGN KEY ([reservationId]) REFERENCES [dbo].[reservations]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[invoices] ADD CONSTRAINT [invoices_creditOfId_fkey] FOREIGN KEY ([creditOfId]) REFERENCES [dbo].[invoices]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[invoices] ADD CONSTRAINT [invoices_createdById_fkey] FOREIGN KEY ([createdById]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[invoice_lines] ADD CONSTRAINT [invoice_lines_invoiceId_fkey] FOREIGN KEY ([invoiceId]) REFERENCES [dbo].[invoices]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[cash_registers] ADD CONSTRAINT [cash_registers_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[cash_sessions] ADD CONSTRAINT [cash_sessions_registerId_fkey] FOREIGN KEY ([registerId]) REFERENCES [dbo].[cash_registers]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[cash_sessions] ADD CONSTRAINT [cash_sessions_openedById_fkey] FOREIGN KEY ([openedById]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[cash_sessions] ADD CONSTRAINT [cash_sessions_closedById_fkey] FOREIGN KEY ([closedById]) REFERENCES [dbo].[users]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[cash_movements] ADD CONSTRAINT [cash_movements_sessionId_fkey] FOREIGN KEY ([sessionId]) REFERENCES [dbo].[cash_sessions]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[cash_movements] ADD CONSTRAINT [cash_movements_createdById_fkey] FOREIGN KEY ([createdById]) REFERENCES [dbo].[users]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[product_categories] ADD CONSTRAINT [product_categories_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[product_categories] ADD CONSTRAINT [product_categories_printerId_fkey] FOREIGN KEY ([printerId]) REFERENCES [dbo].[printers]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[products] ADD CONSTRAINT [products_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[products] ADD CONSTRAINT [products_categoryId_fkey] FOREIGN KEY ([categoryId]) REFERENCES [dbo].[product_categories]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[products] ADD CONSTRAINT [products_taxRateId_fkey] FOREIGN KEY ([taxRateId]) REFERENCES [dbo].[tax_rates]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[orders] ADD CONSTRAINT [orders_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[orders] ADD CONSTRAINT [orders_tableId_fkey] FOREIGN KEY ([tableId]) REFERENCES [dbo].[dining_tables]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[orders] ADD CONSTRAINT [orders_reservationId_fkey] FOREIGN KEY ([reservationId]) REFERENCES [dbo].[reservations]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[orders] ADD CONSTRAINT [orders_openedById_fkey] FOREIGN KEY ([openedById]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[dining_tables] ADD CONSTRAINT [dining_tables_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[order_items] ADD CONSTRAINT [order_items_orderId_fkey] FOREIGN KEY ([orderId]) REFERENCES [dbo].[orders]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[order_items] ADD CONSTRAINT [order_items_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[products]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[order_items] ADD CONSTRAINT [order_items_taxRateId_fkey] FOREIGN KEY ([taxRateId]) REFERENCES [dbo].[tax_rates]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[order_items] ADD CONSTRAINT [order_items_voidedById_fkey] FOREIGN KEY ([voidedById]) REFERENCES [dbo].[users]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[suppliers] ADD CONSTRAINT [suppliers_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[warehouses] ADD CONSTRAINT [warehouses_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[stock_levels] ADD CONSTRAINT [stock_levels_warehouseId_fkey] FOREIGN KEY ([warehouseId]) REFERENCES [dbo].[warehouses]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[stock_levels] ADD CONSTRAINT [stock_levels_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[products]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[stock_movements] ADD CONSTRAINT [stock_movements_warehouseId_fkey] FOREIGN KEY ([warehouseId]) REFERENCES [dbo].[warehouses]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[stock_movements] ADD CONSTRAINT [stock_movements_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[products]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[stock_movements] ADD CONSTRAINT [stock_movements_orderId_fkey] FOREIGN KEY ([orderId]) REFERENCES [dbo].[orders]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[stock_movements] ADD CONSTRAINT [stock_movements_purchaseId_fkey] FOREIGN KEY ([purchaseId]) REFERENCES [dbo].[purchases]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[stock_movements] ADD CONSTRAINT [stock_movements_documentId_fkey] FOREIGN KEY ([documentId]) REFERENCES [dbo].[stock_documents]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[stock_movements] ADD CONSTRAINT [stock_movements_createdById_fkey] FOREIGN KEY ([createdById]) REFERENCES [dbo].[users]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[purchases] ADD CONSTRAINT [purchases_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[purchases] ADD CONSTRAINT [purchases_supplierId_fkey] FOREIGN KEY ([supplierId]) REFERENCES [dbo].[suppliers]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[purchases] ADD CONSTRAINT [purchases_warehouseId_fkey] FOREIGN KEY ([warehouseId]) REFERENCES [dbo].[warehouses]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[purchases] ADD CONSTRAINT [purchases_createdById_fkey] FOREIGN KEY ([createdById]) REFERENCES [dbo].[users]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[purchase_items] ADD CONSTRAINT [purchase_items_purchaseId_fkey] FOREIGN KEY ([purchaseId]) REFERENCES [dbo].[purchases]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[purchase_items] ADD CONSTRAINT [purchase_items_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[products]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[stock_documents] ADD CONSTRAINT [stock_documents_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[stock_documents] ADD CONSTRAINT [stock_documents_warehouseId_fkey] FOREIGN KEY ([warehouseId]) REFERENCES [dbo].[warehouses]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[stock_documents] ADD CONSTRAINT [stock_documents_toWarehouseId_fkey] FOREIGN KEY ([toWarehouseId]) REFERENCES [dbo].[warehouses]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[stock_documents] ADD CONSTRAINT [stock_documents_supplierId_fkey] FOREIGN KEY ([supplierId]) REFERENCES [dbo].[suppliers]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[stock_documents] ADD CONSTRAINT [stock_documents_createdById_fkey] FOREIGN KEY ([createdById]) REFERENCES [dbo].[users]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[stock_document_series] ADD CONSTRAINT [stock_document_series_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[stock_lots] ADD CONSTRAINT [stock_lots_warehouseId_fkey] FOREIGN KEY ([warehouseId]) REFERENCES [dbo].[warehouses]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[stock_lots] ADD CONSTRAINT [stock_lots_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[products]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[stock_document_items] ADD CONSTRAINT [stock_document_items_documentId_fkey] FOREIGN KEY ([documentId]) REFERENCES [dbo].[stock_documents]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[stock_document_items] ADD CONSTRAINT [stock_document_items_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[products]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[user_sessions] ADD CONSTRAINT [user_sessions_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[recipe_items] ADD CONSTRAINT [recipe_items_productId_fkey] FOREIGN KEY ([productId]) REFERENCES [dbo].[products]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[recipe_items] ADD CONSTRAINT [recipe_items_ingredientId_fkey] FOREIGN KEY ([ingredientId]) REFERENCES [dbo].[products]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[email_logs] ADD CONSTRAINT [email_logs_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[receipts] ADD CONSTRAINT [receipts_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[receipts] ADD CONSTRAINT [receipts_seriesId_fkey] FOREIGN KEY ([seriesId]) REFERENCES [dbo].[invoice_series]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[receipts] ADD CONSTRAINT [receipts_paymentTypeId_fkey] FOREIGN KEY ([paymentTypeId]) REFERENCES [dbo].[payment_types]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[receipts] ADD CONSTRAINT [receipts_createdById_fkey] FOREIGN KEY ([createdById]) REFERENCES [dbo].[users]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[receipt_lines] ADD CONSTRAINT [receipt_lines_receiptId_fkey] FOREIGN KEY ([receiptId]) REFERENCES [dbo].[receipts]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[receipt_lines] ADD CONSTRAINT [receipt_lines_invoiceId_fkey] FOREIGN KEY ([invoiceId]) REFERENCES [dbo].[invoices]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[employees] ADD CONSTRAINT [employees_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[employees] ADD CONSTRAINT [employees_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[users]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[payroll_settings] ADD CONSTRAINT [payroll_settings_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[payroll_runs] ADD CONSTRAINT [payroll_runs_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[payroll_runs] ADD CONSTRAINT [payroll_runs_createdById_fkey] FOREIGN KEY ([createdById]) REFERENCES [dbo].[users]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[payslips] ADD CONSTRAINT [payslips_runId_fkey] FOREIGN KEY ([runId]) REFERENCES [dbo].[payroll_runs]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[payslips] ADD CONSTRAINT [payslips_employeeId_fkey] FOREIGN KEY ([employeeId]) REFERENCES [dbo].[employees]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[shifts] ADD CONSTRAINT [shifts_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[shifts] ADD CONSTRAINT [shifts_employeeId_fkey] FOREIGN KEY ([employeeId]) REFERENCES [dbo].[employees]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[time_entries] ADD CONSTRAINT [time_entries_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[time_entries] ADD CONSTRAINT [time_entries_employeeId_fkey] FOREIGN KEY ([employeeId]) REFERENCES [dbo].[employees]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[time_entries] ADD CONSTRAINT [time_entries_editedById_fkey] FOREIGN KEY ([editedById]) REFERENCES [dbo].[users]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[printers] ADD CONSTRAINT [printers_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[payment_types] ADD CONSTRAINT [payment_types_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- CreateIndex (unicos que aceitam varios NULL, como no MySQL)
CREATE UNIQUE NONCLUSTERED INDEX [hotels_publicSlug_key] ON [dbo].[hotels]([publicSlug]) WHERE [publicSlug] IS NOT NULL;
CREATE UNIQUE NONCLUSTERED INDEX [hotels_customDomain_key] ON [dbo].[hotels]([customDomain]) WHERE [customDomain] IS NOT NULL;
CREATE UNIQUE NONCLUSTERED INDEX [reservations_depositPaymentId_key] ON [dbo].[reservations]([depositPaymentId]) WHERE [depositPaymentId] IS NOT NULL;
CREATE UNIQUE NONCLUSTERED INDEX [products_hotelId_sku_key] ON [dbo].[products]([hotelId],[sku]) WHERE [sku] IS NOT NULL;
CREATE UNIQUE NONCLUSTERED INDEX [stock_documents_hotelId_type_year_number_key] ON [dbo].[stock_documents]([hotelId],[type],[year],[number]) WHERE [year] IS NOT NULL AND [number] IS NOT NULL;
CREATE UNIQUE NONCLUSTERED INDEX [employees_userId_key] ON [dbo].[employees]([userId]) WHERE [userId] IS NOT NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

