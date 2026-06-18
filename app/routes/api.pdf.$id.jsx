import db from "../db.server";

/* GET — App Proxy: redirect to waiver PDF by submission ID
   URL: /apps/product-waivers/pdf/:id  (via Shopify App Proxy)
   Used in order confirmation email as a stable link */
export async function loader({ params }) {
  const { id } = params;

  if (!id) {
    return new Response("Missing ID", { status: 400 });
  }

  const submission = await db.waiverSubmission.findUnique({
    where: { id },
    select: { orderPdfUrl: true },
  });

  if (!submission) {
    return new Response("Not found", { status: 404 });
  }

  if (!submission.orderPdfUrl || submission.orderPdfUrl.startsWith("data:")) {
    return new Response("PDF not ready yet. Please try again in a few seconds.", {
      status: 503,
      headers: { "Retry-After": "5" },
    });
  }

  return new Response(null, {
    status: 302,
    headers: { Location: submission.orderPdfUrl },
  });
}
