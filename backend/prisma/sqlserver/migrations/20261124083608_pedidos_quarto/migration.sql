BEGIN TRY

BEGIN TRAN;

-- DropForeignKey
ALTER TABLE [dbo].[orders] DROP CONSTRAINT [orders_tableId_fkey];

-- AlterTable
ALTER TABLE [dbo].[hotels] ADD [roomServiceAutoAccept] BIT NOT NULL CONSTRAINT [hotels_roomServiceAutoAccept_df] DEFAULT 0,
[roomServiceBarHours] NVARCHAR(11),
[roomServiceRestaurantHours] NVARCHAR(11);

-- AlterTable
ALTER TABLE [dbo].[reservations] ADD [roomServiceBlocked] BIT NOT NULL CONSTRAINT [reservations_roomServiceBlocked_df] DEFAULT 0,
[roomServiceLimit] DECIMAL(12,2);

-- AlterTable
ALTER TABLE [dbo].[products] ADD [roomService] BIT NOT NULL CONSTRAINT [products_roomService_df] DEFAULT 1;

-- AlterTable
ALTER TABLE [dbo].[orders] ADD [acceptedAt] DATETIME2,
[deliveredAt] DATETIME2,
[dispatchedAt] DATETIME2,
[rejectReason] NVARCHAR(200),
[roomDeviceId] INT,
[roomId] INT,
[roomServiceStatus] NVARCHAR(40);

-- CreateTable
CREATE TABLE [dbo].[room_devices] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [roomId] INT NOT NULL,
    [name] NVARCHAR(60),
    [tokenHash] NVARCHAR(64),
    [pairingCode] NVARCHAR(6),
    [pairingExpiresAt] DATETIME2,
    [pairedAt] DATETIME2,
    [lastSeenAt] DATETIME2,
    [active] BIT NOT NULL CONSTRAINT [room_devices_active_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [room_devices_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [room_devices_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [room_devices_hotelId_idx] ON [dbo].[room_devices]([hotelId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [room_devices_pairingCode_idx] ON [dbo].[room_devices]([pairingCode]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [orders_hotelId_roomServiceStatus_idx] ON [dbo].[orders]([hotelId], [roomServiceStatus]);

-- AddForeignKey
ALTER TABLE [dbo].[room_devices] ADD CONSTRAINT [room_devices_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[room_devices] ADD CONSTRAINT [room_devices_roomId_fkey] FOREIGN KEY ([roomId]) REFERENCES [dbo].[rooms]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[orders] ADD CONSTRAINT [orders_tableId_fkey] FOREIGN KEY ([tableId]) REFERENCES [dbo].[dining_tables]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[orders] ADD CONSTRAINT [orders_roomId_fkey] FOREIGN KEY ([roomId]) REFERENCES [dbo].[rooms]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[orders] ADD CONSTRAINT [orders_roomDeviceId_fkey] FOREIGN KEY ([roomDeviceId]) REFERENCES [dbo].[room_devices]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- CreateIndex (unicos que aceitam varios NULL, como no MySQL)
CREATE UNIQUE NONCLUSTERED INDEX [room_devices_tokenHash_key] ON [dbo].[room_devices]([tokenHash]) WHERE [tokenHash] IS NOT NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

