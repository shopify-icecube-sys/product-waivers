import db from "../db.server";

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/* GET — App Proxy health check */
export async function loader() {
  return jsonRes({ ok: true });
}

/* POST — Save waiver submission (called via Shopify App Proxy) */
export async function action({ request }) {
  try {
    if (request.method !== "POST") {
      return jsonRes({ error: "Method not allowed" }, 405);
    }

    let data;
    try {
      data = await request.json();
    } catch {
      return jsonRes({ error: "Invalid JSON body" }, 400);
    }

    const required = [
      "shop", "productHandle",
      "fullName", "email", "phone", "driversLicense",
      "streetAddress", "city", "state", "zip",
      "vehicleYear", "vehicleMake", "vehicleModel", "vehicleColor", "vin",
      "docTrailerName", "docNonRoadName", "docEventName",
      "racingUseOnly", "notOnPublicRoads", "notCarbApproved", "notEpaCertified",
      "printedName", "signatureDate", "digitalSignature",
      "certCarbApproved", "certEpaCertified", "certPerjury",
    ];

    for (const field of required) {
      if (!data[field]) {
        return jsonRes({ error: `Missing required field: ${field}` }, 422);
      }
    }

    /* Core fields — always supported */
    const coreData = {
      shop:              String(data.shop),
      productHandle:     String(data.productHandle),
      fullName:          String(data.fullName),
      email:             String(data.email),
      phone:             String(data.phone),
      driversLicense:    String(data.driversLicense),
      streetAddress:     String(data.streetAddress),
      city:              String(data.city),
      state:             String(data.state),
      zip:               String(data.zip),
      raceClub:          data.raceClub        ? String(data.raceClub)        : null,
      vehicleYear:       String(data.vehicleYear),
      vehicleMake:       String(data.vehicleMake),
      vehicleModel:      String(data.vehicleModel),
      vehicleColor:      String(data.vehicleColor),
      vin:               String(data.vin),
      dmvRegistered:     data.dmvRegistered   ? String(data.dmvRegistered)   : null,
      licensedForRoad:   data.licensedForRoad ? String(data.licensedForRoad) : null,
      docTrailerName:    String(data.docTrailerName),
      docNonRoadName:    String(data.docNonRoadName),
      docEventName:      String(data.docEventName),
      docClubName:       data.docClubName     ? String(data.docClubName)     : null,
      racingUseOnly:     String(data.racingUseOnly),
      notOnPublicRoads:  String(data.notOnPublicRoads),
      notCarbApproved:   String(data.notCarbApproved),
      notEpaCertified:   String(data.notEpaCertified),
      printedName:       String(data.printedName),
      signatureDate:     String(data.signatureDate),
      digitalSignature:  String(data.digitalSignature),
      certCarbApproved:  String(data.certCarbApproved),
      certEpaCertified:  String(data.certEpaCertified),
      certPerjury:       String(data.certPerjury),
    };

    /* PDF content fields — added in migration 2.
       If the Prisma client hasn't been regenerated yet these will cause an
       "Unknown field" error; in that case we fall back to saving without them. */
    const contentData = {
      docTrailerContent: data.docTrailerContent || null,
      docNonRoadContent: data.docNonRoadContent || null,
      docEventContent:   data.docEventContent   || null,
      docClubContent:    data.docClubContent     || null,
    };

    let submission;
    try {
      submission = await db.waiverSubmission.create({
        data: { ...coreData, ...contentData },
      });
    } catch (e) {
      /* Prisma client predates migration 2 — save without file content */
      console.warn("[Waiver] Saving without PDF content (run `npx prisma generate` to enable downloads):", e?.message);
      submission = await db.waiverSubmission.create({ data: coreData });
    }

    return jsonRes({ success: true, id: submission.id });

  } catch (err) {
    console.error("[Waiver] Unhandled error:", err?.message || err);
    return jsonRes({ error: "Server error: " + (err?.message || "unknown") }, 500);
  }
}
