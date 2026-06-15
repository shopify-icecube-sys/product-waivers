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
  const { generateWaiverPdf } = await import("../utils/generateWaiverPdf.server.js");
  const { uploadPdfBuffer }   = await import("../utils/uploadPdfBuffer.server.js");

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

  // Lock the submission immediately to prevent duplicate processing from retried webhooks
  const locked = await db.waiverSubmission.updateMany({
    where: { id: submission.id, orderNumber: null },
    data:  { orderNumber: orderName },
  });

  if (locked.count === 0) {
    console.log(`[Webhook] Submission ${submission.id} already claimed by another delivery — skipping`);
    return;
  }

  console.log(`[Webhook] Locked submission ${submission.id} for ${orderName}`);

  try {
    const pdfBuffer = await generateWaiverPdf({ ...submission, orderNumber: orderName });

    const safeName = (submission.fullName || "Customer")
      .replace(/[^a-zA-Z0-9 ]/g, "")
      .trim()
      .replace(/\s+/g, "_") || "Customer";
    const filename = `${orderName.replace("#", "")}_${safeName}.pdf`;

    const pdfUrl = await uploadPdfBuffer(admin, pdfBuffer, filename);

    await db.waiverSubmission.update({
      where: { id: submission.id },
      data:  { orderPdfUrl: pdfUrl },
    });

    // Save PDF URL to order metafield custom.waiver_form
    if (orderId && pdfUrl) {
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
    }

    console.log(`[Webhook] PDF done → ${filename} | ${pdfUrl}`);
  } catch (err) {
    console.error(`[Webhook] PDF generation failed for ${submission.id}:`, err?.message);
  }
}
