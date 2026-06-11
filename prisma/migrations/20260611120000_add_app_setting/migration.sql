-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "buttonColor" TEXT NOT NULL DEFAULT '#2563eb',
    "progressColor" TEXT NOT NULL DEFAULT '#2563eb'
);

-- CreateIndex
CREATE UNIQUE INDEX "AppSetting_shop_key" ON "AppSetting"("shop");
