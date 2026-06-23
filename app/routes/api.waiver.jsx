import db from "../db.server";
import { unauthenticated } from "../shopify.server";

function jsonRes(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/* CustomerName_gJhWeR.pdf — unique suffix per call */
function makeFilename(fullName) {
  const safe = (fullName || "Customer")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim()
    .replace(/\s+/g, "_") || "Customer";
  const uid = Math.random().toString(36).slice(2, 8);
  return `${safe}_${uid}.pdf`;
}

/* GET — App Proxy health check */
export async function loader() {
  return jsonRes({ ok: true });
}

/* Upload a single PDF/document buffer to Shopify Files; returns CDN URL or null */
async function uploadDoc(admin, content, filename) {
  if (!content || !content.startsWith("data:")) return null;
  const base64 = content.split(",")[1];
  if (!base64) return null;
  try {
    const buffer = Buffer.from(base64, "base64");
    const { uploadPdfBuffer } = await import("../utils/uploadPdfBuffer.server.js");
    return await uploadPdfBuffer(admin, buffer, filename, "application/pdf");
  } catch (err) {
    console.error(`[Waiver] Doc upload failed (${filename}):`, err?.message);
    return null;
  }
}

/* Upload multiple images to Shopify Files; returns array of CDN URLs */
async function uploadImages(admin, contents, filenameBase) {
  if (!Array.isArray(contents) || !contents.length) return [];
  const { uploadPdfBuffer } = await import("../utils/uploadPdfBuffer.server.js");
  const results = await Promise.all(
    contents.map(async (content, i) => {
      if (!content || !content.startsWith("data:")) return null;
      try {
        const mimeType = content.split(";")[0].split(":")[1] || "image/jpeg";
        const ext      = mimeType.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
        const base64   = content.split(",")[1];
        if (!base64) return null;
        const buffer   = Buffer.from(base64, "base64");
        const uid      = Math.random().toString(36).slice(2, 6);
        const filename = `${filenameBase}_${i + 1}_${uid}.${ext}`;
        return await uploadPdfBuffer(admin, buffer, filename, mimeType);
      } catch (err) {
        console.error(`[Waiver] Image upload failed (${filenameBase}_${i + 1}):`, err?.message);
        return null;
      }
    })
  );
  return results.filter(Boolean);
}

/* Set order metafield custom.waiver_form using the Shopify order GID stored by webhook.
   Uses orderId directly — no orders query needed, avoids any read_orders permission issues. */
async function setOrderMetafield(admin, orderGid, pdfUrl) {
  if (!orderGid || !pdfUrl) return;
  const metaMutation = `#graphql
    mutation SetWaiverMetafield($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id key namespace value }
        userErrors { field message }
      }
    }`;
  try {
    for (const type of ["single_line_text_field", "url"]) {
      const metaRes  = await admin.graphql(metaMutation, {
        variables: {
          metafields: [{ ownerId: orderGid, namespace: "custom", key: "waiver_form", value: pdfUrl, type }],
        },
      });
      const metaJson = await metaRes.json();
      const errs     = metaJson.data?.metafieldsSet?.userErrors;
      if (!errs?.length) {
        console.log(`[Waiver] Metafield saved (type=${type}) for order ${orderGid}`);
        return;
      }
      console.warn(`[Waiver] Metafield type=${type} failed:`, errs.map((e) => e.message).join(", "));
    }
  } catch (err) {
    console.error(`[Waiver] setOrderMetafield error for ${orderGid}:`, err?.message);
  }
}

/* Upload images first, then PDFs, then generate final PDF with embedded images + CDN links */
async function uploadDocsAndGeneratePdf(submissionId, data, shop) {
  try {
    const { admin } = await unauthenticated.admin(shop);

    const safeName = (data.fullName || "waiver")
      .replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/\s+/g, "_") || "waiver";

    // Step 1: Upload all docs to Shopify Files (images + PDFs in parallel)
    const [trailerUrls, nonRoadUrls, eventUrl, clubUrl] = await Promise.all([
      uploadImages(admin, data.docTrailerContent, `${safeName}_trailer`),
      uploadImages(admin, data.docNonRoadContent, `${safeName}_nonroad`),
      uploadDoc(admin, data.docEventContent, data.docEventName),
      data.docClubContent && data.docClubName
        ? uploadDoc(admin, data.docClubContent, data.docClubName)
        : Promise.resolve(null),
    ]);

    // Step 2: Persist CDN URLs to DB
    const docUpdates = {};
    if (trailerUrls.length) docUpdates.docTrailerUrl = JSON.stringify(trailerUrls);
    if (nonRoadUrls.length) docUpdates.docNonRoadUrl = JSON.stringify(nonRoadUrls);
    if (eventUrl)           docUpdates.docEventUrl   = eventUrl;
    if (clubUrl)            docUpdates.docClubUrl    = clubUrl;

    let updatedSubmission;
    if (Object.keys(docUpdates).length > 0) {
      updatedSubmission = await db.waiverSubmission.update({
        where: { id: submissionId },
        data:  docUpdates,
      });
      console.log(`[Waiver] Docs uploaded for submission ${submissionId}`);
    } else {
      updatedSubmission = await db.waiverSubmission.findUnique({ where: { id: submissionId } });
    }

    // Step 3: Generate PDF — embed images directly from memory, use CDN links for PDFs
    const { generateWaiverPdf } = await import("../utils/generateWaiverPdf.server.js");
    const { uploadPdfBuffer }   = await import("../utils/uploadPdfBuffer.server.js");

    const pdfBuffer = await generateWaiverPdf(updatedSubmission, {
      trailerImages: Array.isArray(data.docTrailerContent) ? data.docTrailerContent : [],
      nonRoadImages: Array.isArray(data.docNonRoadContent) ? data.docNonRoadContent : [],
    });
    const filename  = makeFilename(updatedSubmission.fullName);
    const pdfUrl    = await uploadPdfBuffer(admin, pdfBuffer, filename);

    if (pdfUrl) {
      // Update DB with PDF URL
      await db.waiverSubmission.update({
        where: { id: submissionId },
        data:  { orderPdfUrl: pdfUrl },
      });
      console.log(`[Waiver] Submission PDF generated for ${submissionId}`);

      // Read orderGid via raw SQL — set by webhook when it locked the submission
      const rows = await db.$queryRaw`SELECT "orderGid" FROM "WaiverSubmission" WHERE "id" = ${submissionId} LIMIT 1`;
      const orderGid = rows[0]?.orderGid ?? null;
      if (orderGid) {
        await setOrderMetafield(admin, orderGid, pdfUrl);
      } else {
        console.log(`[Waiver] orderGid not yet set for ${submissionId} — webhook may not have run yet`);
      }
    }
  } catch (err) {
    console.error(`[Waiver] Background processing error (${submissionId}):`, err?.message);
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
      docTrailerName:    Array.isArray(data.docTrailerName)
                           ? data.docTrailerName.filter(Boolean).join(", ")
                           : String(data.docTrailerName),
      docNonRoadName:    Array.isArray(data.docNonRoadName)
                           ? data.docNonRoadName.filter(Boolean).join(", ")
                           : String(data.docNonRoadName),
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

    // Images (trailer/nonroad) are uploaded async — no base64 placeholder needed
    // PDFs (event/club) keep base64 placeholder so PDF can fall back if CDN upload fails
    const contentData = {
      docTrailerUrl: null,
      docNonRoadUrl: null,
      docEventUrl:   data.docEventContent || null,
      docClubUrl:    data.docClubContent  || null,
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

    // Upload docs then generate PDF (sequential) in background — does not delay response
    uploadDocsAndGeneratePdf(submission.id, data, shop).catch(() => {});

    return jsonRes({ success: true, id: submission.id });

  } catch (err) {
    console.error("[Waiver] Unhandled error:", err?.message || err);
    return jsonRes({ error: "Server error: " + (err?.message || "unknown") }, 500);
  }
}
