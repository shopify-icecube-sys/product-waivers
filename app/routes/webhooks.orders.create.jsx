import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  let authResult;
  try {
    authResult = await authenticate.webhook(request);
  } catch (authErr) {
    if (authErr instanceof Response) {
      console.error(`[Webhook] Auth rejected – HTTP ${authErr.status}`);
      return authErr;
    }
    console.error("[Webhook] Auth error:", authErr?.message);
    return new Response("Auth error", { status: 401 });
  }

  const { topic, shop, admin, payload } = authResult;
  console.log(`[Webhook] ${topic} received for ${shop}`);

  // Return 200 immediately so Shopify does not retry (timeout = 5s, processing > 5s)
  processOrder(admin, payload, shop).catch((err) =>
    console.error("[Webhook] Background processing error:", err?.message)
  );

  return new Response(null, { status: 200 });
};

async function processOrder(admin, order, shop) {
  const orderName = order.name || `#${order.order_number}`;
  const orderId   = order.admin_graphql_api_id;

  const productIds = [
    ...new Set(
      (order.line_items || [])
        .map((li) => li.product_id)
        .filter(Boolean)
        .map((id) => `gid://shopify/Product/${id}`)
    ),
  ];

  if (productIds.length === 0) {
    console.log("[Webhook] No product IDs — skipping");
    return;
  }

  const productsRes  = await admin.graphql(
    `#graphql
    query GetProductHandles($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product { id handle }
      }
    }`,
    { variables: { ids: productIds } }
  );
  const productsJson = await productsRes.json();

  const handles = (productsJson.data?.nodes || [])
    .filter(Boolean)
    .map((n) => n.handle)
    .filter(Boolean);

  const customerEmail = order.email || order.contact_email || null;
  console.log(`[Webhook] order=${orderName} | handles=${handles.join(", ")} | email=${customerEmail || "NOT_AVAILABLE"}`);
  console.log(`[Webhook] note_attributes=${JSON.stringify(order.note_attributes || [])}`);

  if (handles.length === 0) {
    console.log("[Webhook] Could not resolve product handles — skipping");
    return;
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  let submission = null;

  // Strategy 1: cart attribute waiver_submission_id
  const waiverAttr  = (order.note_attributes || []).find((a) => a.name === "waiver_submission_id");
  const waiverSubId = waiverAttr?.value;
  if (waiverSubId) {
    console.log(`[Webhook] Strategy 1 – cart attr id=${waiverSubId}`);
    const s = await db.waiverSubmission.findUnique({ where: { id: waiverSubId } });
    if (s && !s.orderNumber) submission = s;
    else console.log(`[Webhook] Strategy 1 miss – found=${!!s} processed=${s?.orderNumber || "no"}`);
  }

  // Strategy 2: most recent unmatched submission for any ordered product
  if (!submission) {
    console.log("[Webhook] Strategy 2 – most recent unmatched by product");
    submission = await db.waiverSubmission.findFirst({
      where: {
        shop,
        productHandle: { in: handles },
        orderNumber:   null,
        createdAt:     { gte: since },
      },
      orderBy: { createdAt: "desc" },
    });
    console.log(`[Webhook] Strategy 2 ${submission ? "matched id=" + submission.id : "no match"}`);
  }

  if (!submission) {
    console.log("[Webhook] No unprocessed submission found — skipping");
    return;
  }

  // Lock submission and store orderId via raw SQL (orderGid column added in migration)
  const affectedRows = await db.$executeRaw`
    UPDATE "WaiverSubmission"
    SET "orderNumber" = ${orderName}, "orderGid" = ${orderId}
    WHERE "id" = ${submission.id} AND "orderNumber" IS NULL
  `;

  if (affectedRows === 0) {
    console.log(`[Webhook] Submission ${submission.id} already claimed by another delivery — skipping`);
    return;
  }

  console.log(`[Webhook] Locked submission ${submission.id} for ${orderName}`);

  // PDF is generated in background after form submit (image upload + PDF generation can take 1-2 min).
  // Poll DB until orderPdfUrl is ready (max 2 minutes: 24 polls × 5s).
  let pdfUrl = submission.orderPdfUrl?.startsWith("http") ? submission.orderPdfUrl : null;

  if (!pdfUrl) {
    console.log(`[Webhook] PDF not ready yet — polling DB for up to 2 minutes…`);
    for (let attempt = 0; attempt < 24 && !pdfUrl; attempt++) {
      await new Promise((r) => setTimeout(r, 5000));
      const refreshed = await db.waiverSubmission.findUnique({ where: { id: submission.id } });
      pdfUrl = refreshed?.orderPdfUrl?.startsWith("http") ? refreshed.orderPdfUrl : null;
      if (pdfUrl) console.log(`[Webhook] PDF ready after ${(attempt + 1) * 5}s`);
    }
    if (!pdfUrl) console.warn(`[Webhook] PDF still not ready after 2 min for submission ${submission.id}`);
  }

  if (orderId && pdfUrl) {
    try {
      const metaMutation = `#graphql
        mutation SetWaiverMetafield($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields { id key namespace value }
            userErrors { field message }
          }
        }`;
      for (const type of ["single_line_text_field", "url"]) {
        const metaRes  = await admin.graphql(metaMutation, {
          variables: {
            metafields: [{ ownerId: orderId, namespace: "custom", key: "waiver_form", value: pdfUrl, type }],
          },
        });
        const metaJson = await metaRes.json();
        const errs     = metaJson.data?.metafieldsSet?.userErrors;
        if (!errs?.length) {
          console.log(`[Webhook] Metafield saved (type=${type}) for ${orderId}`);
          break;
        }
        console.warn(`[Webhook] Metafield type=${type} failed:`, errs.map((e) => e.message).join(", "));
      }
    } catch (err) {
      console.error(`[Webhook] Metafield save failed:`, err?.message);
    }
  }

  console.log(`[Webhook] Order ${orderName} linked to submission ${submission.id}`);
}
