import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { topic, shop, admin, payload } = await authenticate.webhook(request);
  console.log(`[Webhook] ${topic} received for ${shop}`);

  const { generateWaiverPdf } = await import("../utils/generateWaiverPdf.server.js");
  const { uploadPdfBuffer }   = await import("../utils/uploadPdfBuffer.server.js");

  try {
    const order = payload;

    const customerEmail =
      order.email ||
      order.contact_email ||
      order.customer?.email ||
      order.billing_address?.email;

    const customerName =
      [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(" ").trim() ||
      order.billing_address?.name ||
      order.shipping_address?.name ||
      "";

    const orderName = order.name || `#${order.order_number}`;

    console.log(`[Webhook] email=${customerEmail || "none"}, name=${customerName || "none"}, order=${orderName}`);

    // Collect unique Shopify product GIDs from line items
    const productIds = [
      ...new Set(
        (order.line_items || [])
          .map((li) => li.product_id)
          .filter(Boolean)
          .map((id) => `gid://shopify/Product/${id}`)
      ),
    ];

    if (productIds.length === 0) {
      console.log("[Webhook] No product IDs in line items — skipping");
      return new Response(null, { status: 200 });
    }

    // Resolve product IDs → handles via GraphQL
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

    if (handles.length === 0) {
      console.log("[Webhook] Could not resolve product handles — skipping");
      return new Response(null, { status: 200 });
    }

    console.log(`[Webhook] product handles: ${handles.join(", ")}`);

    // Only consider submissions from the last 30 days
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Build DB query — match by email if available, else by name (take 1 most recent)
    const whereClause = {
      shop,
      productHandle: { in: handles },
      orderNumber:   null,
      createdAt:     { gte: since },
    };

    if (customerEmail) {
      whereClause.email = customerEmail;
    } else if (customerName) {
      // No email — match first name only, take most recent 1 per product handle
      whereClause.fullName = { contains: customerName.split(" ")[0] };
    }

    const allMatched = await db.waiverSubmission.findMany({
      where:   whereClause,
      orderBy: { createdAt: "desc" },
    });

    // When matching by name (no email), take only the single most recent per product handle
    let submissions;
    if (customerEmail) {
      submissions = allMatched;
    } else {
      const seen = new Set();
      submissions = allMatched.filter((s) => {
        if (seen.has(s.productHandle)) return false;
        seen.add(s.productHandle);
        return true;
      });
    }

    console.log(`[Webhook] matched ${submissions.length} submission(s) (from ${allMatched.length} candidates)`);

    if (submissions.length === 0) {
      console.log("[Webhook] No unprocessed submissions found — skipping");
      return new Response(null, { status: 200 });
    }

    // Generate and upload a PDF for each matched submission
    const pdfName = customerName || submissions[0]?.fullName || "Customer";

    for (const submission of submissions) {
      try {
        const submissionWithOrder = { ...submission, orderNumber: orderName };
        const pdfBuffer = await generateWaiverPdf(submissionWithOrder);

        const safeName = pdfName
          .replace(/[^a-zA-Z0-9 ]/g, "")
          .trim()
          .replace(/\s+/g, "_");
        const filename = `${orderName.replace("#", "")}_${safeName}.pdf`;

        const pdfUrl = await uploadPdfBuffer(admin, pdfBuffer, filename);

        await db.waiverSubmission.update({
          where: { id: submission.id },
          data:  { orderNumber: orderName, orderPdfUrl: pdfUrl },
        });

        console.log(`[Webhook] PDF uploaded → ${filename} | URL: ${pdfUrl}`);
      } catch (err) {
        console.error(`[Webhook] Failed for submission ${submission.id}:`, err?.message);
        await db.waiverSubmission.update({
          where: { id: submission.id },
          data:  { orderNumber: orderName },
        }).catch(() => {});
      }
    }

    return new Response(null, { status: 200 });
  } catch (err) {
    console.error("[Webhook] Unhandled error:", err?.message);
    return new Response(null, { status: 200 });
  }
};
