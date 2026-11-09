BEGIN TRY

BEGIN TRAN;

-- DropForeignKey
ALTER TABLE [dbo].[users] DROP CONSTRAINT [users_hotelId_fkey];

-- AlterTable
ALTER TABLE [dbo].[users] ADD [profileId] INT;

-- CreateTable
CREATE TABLE [dbo].[access_profiles] (
    [id] INT NOT NULL IDENTITY(1,1),
    [hotelId] INT NOT NULL,
    [name] NVARCHAR(80) NOT NULL,
    [baseRole] NVARCHAR(40) NOT NULL CONSTRAINT [access_profiles_baseRole_df] DEFAULT 'RECEPTION',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [access_profiles_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [access_profiles_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [access_profiles_hotelId_name_key] UNIQUE NONCLUSTERED ([hotelId],[name])
);

-- CreateTable
CREATE TABLE [dbo].[access_profile_permissions] (
    [id] INT NOT NULL IDENTITY(1,1),
    [profileId] INT NOT NULL,
    [area] NVARCHAR(40) NOT NULL,
    [level] NVARCHAR(40) NOT NULL,
    CONSTRAINT [access_profile_permissions_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [access_profile_permissions_profileId_area_key] UNIQUE NONCLUSTERED ([profileId],[area])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [users_profileId_idx] ON [dbo].[users]([profileId]);

-- AddForeignKey
ALTER TABLE [dbo].[users] ADD CONSTRAINT [users_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[users] ADD CONSTRAINT [users_profileId_fkey] FOREIGN KEY ([profileId]) REFERENCES [dbo].[access_profiles]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[access_profiles] ADD CONSTRAINT [access_profiles_hotelId_fkey] FOREIGN KEY ([hotelId]) REFERENCES [dbo].[hotels]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[access_profile_permissions] ADD CONSTRAINT [access_profile_permissions_profileId_fkey] FOREIGN KEY ([profileId]) REFERENCES [dbo].[access_profiles]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

