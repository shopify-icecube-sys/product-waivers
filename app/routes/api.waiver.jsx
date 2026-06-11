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

    // Real customer IP — Shopify App Proxy forwards it in x-forwarded-for
    const rawIp  = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "";
    const ipAddress = rawIp.split(",")[0].trim() || null;

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
      ipAddress,
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

    /* Store base64 PDF content. The admin submissions page will upload these
       to Shopify Files and replace them with CDN URLs on first view. */
    const contentData = {
      docTrailerUrl: data.docTrailerContent || null,
      docNonRoadUrl: data.docNonRoadContent || null,
      docEventUrl:   data.docEventContent   || null,
      docClubUrl:    data.docClubContent     || null,
    };

    let submission;
    try {
      submission = await db.waiverSubmission.create({
        data: { ...coreData, ...contentData },
      });
    } catch (e) {
      // Fallback 1: binary may not know about new PDF url columns yet — strip them
      try {
        submission = await db.waiverSubmission.create({ data: coreData });
        console.warn("[Waiver] Saved without PDF content (restart server + run `npx prisma generate`):", e?.message);
      } catch (e2) {
        // Fallback 2: binary may not know about ipAddress yet — strip it too
        const { ipAddress: _ip, ...coreWithoutIp } = coreData;
        submission = await db.waiverSubmission.create({ data: coreWithoutIp });
        console.warn("[Waiver] Saved without ipAddress (restart server + run `npx prisma generate`):", e2?.message);
      }
    }

    return jsonRes({ success: true, id: submission.id });

  } catch (err) {
    console.error("[Waiver] Unhandled error:", err?.message || err);
    return jsonRes({ error: "Server error: " + (err?.message || "unknown") }, 500);
  }
}
