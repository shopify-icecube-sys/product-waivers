-- CreateTable
CREATE TABLE "WaiverSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shop" TEXT NOT NULL,
    "productHandle" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "driversLicense" TEXT NOT NULL,
    "streetAddress" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "raceClub" TEXT,
    "vehicleYear" TEXT NOT NULL,
    "vehicleMake" TEXT NOT NULL,
    "vehicleModel" TEXT NOT NULL,
    "vehicleColor" TEXT NOT NULL,
    "vin" TEXT NOT NULL,
    "dmvRegistered" TEXT,
    "licensedForRoad" TEXT,
    "docTrailerName" TEXT NOT NULL,
    "docNonRoadName" TEXT NOT NULL,
    "docEventName" TEXT NOT NULL,
    "docClubName" TEXT,
    "racingUseOnly" TEXT NOT NULL,
    "notOnPublicRoads" TEXT NOT NULL,
    "notCarbApproved" TEXT NOT NULL,
    "notEpaCertified" TEXT NOT NULL,
    "printedName" TEXT NOT NULL,
    "signatureDate" TEXT NOT NULL,
    "digitalSignature" TEXT NOT NULL,
    "certCarbApproved" TEXT NOT NULL,
    "certEpaCertified" TEXT NOT NULL,
    "certPerjury" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "WaiverSubmission_shop_idx" ON "WaiverSubmission"("shop");

-- CreateIndex
CREATE INDEX "WaiverSubmission_email_idx" ON "WaiverSubmission"("email");
