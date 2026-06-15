import db from "../db.server";
import { unauthenticated } from "../shopify.server";

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

/* Upload one document buffer to Shopify Files; returns CDN URL or null */
async function uploadDoc(admin, content, filename) {
  if (!content || !content.startsWith("data:")) return null;
  const base64 = content.split(",")[1];
  if (!base64) return null;
  try {
    const buffer = Buffer.from(base64, "base64");
    const { uploadPdfBuffer } = await import("../utils/uploadPdfBuffer.server.js");
    return await uploadPdfBuffer(admin, buffer, filename);
  } catch (err) {
    console.error(`[Waiver] Doc upload failed (${filename}):`, err?.message);
    return null;
  }
}

/* Background: upload the 4 user documents to Shopify Files, then update DB */
async function uploadDocsBackground(submissionId, data, shop) {
  try {
    const { admin } = await unauthenticated.admin(shop);

    const [trailerUrl, nonRoadUrl, eventUrl, clubUrl] = await Promise.all([
      uploadDoc(admin, data.docTrailerContent, data.docTrailerName),
      uploadDoc(admin, data.docNonRoadContent, data.docNonRoadName),
      uploadDoc(admin, data.docEventContent,   data.docEventName),
      data.docClubContent && data.docClubName
        ? uploadDoc(admin, data.docClubContent, data.docClubName)
        : Promise.resolve(null),
    ]);

    const updates = {};
    if (trailerUrl) updates.docTrailerUrl = trailerUrl;
    if (nonRoadUrl) updates.docNonRoadUrl = nonRoadUrl;
    if (eventUrl)   updates.docEventUrl   = eventUrl;
    if (clubUrl)    updates.docClubUrl    = clubUrl;

    if (Object.keys(updates).length > 0) {
      await db.waiverSubmission.update({ where: { id: submissionId }, data: updates });
      console.log(`[Waiver] Docs uploaded for submission ${submissionId}`);
    }
  } catch (err) {
    console.error(`[Waiver] Background doc upload error (${submissionId}):`, err?.message);
  }
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
    const ipList = rawIp.split(",").map(ip => ip.trim()).filter(Boolean);
    const ipv4Re = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipAddress = ipList.find(ip => ipv4Re.test(ip)) || ipList[0] || null;

    const shop = String(data.shop);

    const coreData = {
      shop,
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

    // Save base64 content as placeholder until background upload completes
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
      try {
        submission = await db.waiverSubmission.create({ data: coreData });
        console.warn("[Waiver] Saved without PDF content:", e?.message);
      } catch (e2) {
        const { ipAddress: _ip, ...coreWithoutIp } = coreData;
        submission = await db.waiverSubmission.create({ data: coreWithoutIp });
        console.warn("[Waiver] Saved without ipAddress:", e2?.message);
      }
    }

    // Upload 4 documents to Shopify Files in background — does not delay response
    uploadDocsBackground(submission.id, data, shop).catch(() => {});

    return jsonRes({ success: true, id: submission.id });

  } catch (err) {
    console.error("[Waiver] Unhandled error:", err?.message || err);
    return jsonRes({ error: "Server error: " + (err?.message || "unknown") }, 500);
  }
}
