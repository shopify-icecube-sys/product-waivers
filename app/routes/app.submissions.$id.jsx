/* eslint-disable react/prop-types */
import { useLoaderData, useNavigate } from "react-router";
import { redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  Page, Card, Button, Text, BlockStack, InlineStack,
  Box, InlineGrid, Spinner, Banner,
} from "@shopify/polaris";

export const loader = async ({ request, params }) => {
  await authenticate.admin(request);
  const submission = await db.waiverSubmission.findUnique({
    where: { id: params.id },
  });
  if (!submission) throw redirect("/app/submissions");
  return { submission };
};

export const action = async ({ request, params }) => {
  const { admin } = await authenticate.admin(request);
  const formData   = await request.formData();
  const orderNumber = String(formData.get("orderNumber") || "").trim();

  if (!orderNumber) return { error: "Order number is required." };

  const submission = await db.waiverSubmission.findUnique({ where: { id: params.id } });
  if (!submission) return { error: "Submission not found." };

  const { generateWaiverPdf } = await import("../utils/generateWaiverPdf.server.js");
  const { uploadPdfBuffer }   = await import("../utils/uploadPdfBuffer.server.js");

  try {
    const submissionWithOrder = { ...submission, orderNumber };
    const pdfBuffer = await generateWaiverPdf(submissionWithOrder);

    const safeName = submission.fullName
      .replace(/[^a-zA-Z0-9 ]/g, "")
      .trim()
      .replace(/\s+/g, "_");
    const filename = `${orderNumber.replace("#", "")}_${safeName}.pdf`;

    const pdfUrl = await uploadPdfBuffer(admin, pdfBuffer, filename);

    await db.waiverSubmission.update({
      where: { id: params.id },
      data:  { orderNumber, orderPdfUrl: pdfUrl },
    });

    // Save PDF URL to order metafield custom.waiver_form
    try {
      const orderRes  = await admin.graphql(
        `#graphql
        query GetOrderId($query: String!) {
          orders(first: 1, query: $query) {
            edges { node { id } }
          }
        }`,
        { variables: { query: `name:${orderNumber}` } }
      );
      const orderJson = await orderRes.json();
      const orderId   = orderJson.data?.orders?.edges?.[0]?.node?.id;
      if (orderId) {
        const metaMutation = `#graphql
          mutation SetWaiverMetafield($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              metafields { id key namespace value }
              userErrors { field message }
            }
          }`;
        for (const type of ["url", "single_line_text_field"]) {
          const metaRes  = await admin.graphql(metaMutation, {
            variables: {
              metafields: [{ ownerId: orderId, namespace: "custom", key: "waiver_form", value: pdfUrl, type }],
            },
          });
          const metaJson = await metaRes.json();
          const errs     = metaJson.data?.metafieldsSet?.userErrors;
          if (!errs?.length) {
            console.log(`[PDF] Metafield saved (type=${type}) for order ${orderId}`);
            break;
          }
          console.warn(`[PDF] Metafield type=${type} failed:`, errs.map(e => e.message).join(", "));
        }
      }
    } catch (metaErr) {
      console.error("[PDF] Metafield save failed:", metaErr?.message);
    }

    return { success: true, pdfUrl };
  } catch (err) {
    return { error: "PDF generation failed: " + (err?.message || "unknown error") };
  }
};

/* ── helpers ── */
function fmt(d) {
  return new Date(d).toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}
function dash(v) { return v || "—"; }

function YN({ v }) {
  if (v === "yes") return <Text as="span" tone="success" fontWeight="bold">Yes</Text>;
  if (v === "no")  return <Text as="span" tone="critical" fontWeight="bold">No</Text>;
  return <Text as="span">—</Text>;
}

function Field({ label, value }) {
  return (
    <BlockStack gap="100">
      <Text as="span" variant="bodySm" tone="subdued" fontWeight="bold" textTransform="uppercase">{label}</Text>
      <Text as="span" variant="bodyMd">{value ?? "—"}</Text>
    </BlockStack>
  );
}

function DocLink({ content, filename }) {
  if (!filename) return <Text as="span">—</Text>;

  const isUrl       = content?.startsWith("https://");
  const isUploading = content === "__uploading__";
  const isBase64    = content?.startsWith("data:");

  const downloadLegacy = () => {
    const a = document.createElement("a");
    a.href = content;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <BlockStack gap="100">
      <Text as="span" variant="bodySm" tone="subdued" fontWeight="bold">{filename}</Text>
      {isUrl ? (
        <InlineStack gap="200" blockAlign="center">
          <Button size="micro" url={content} external>View PDF</Button>
        </InlineStack>
      ) : isUploading ? (
        <InlineStack gap="200" blockAlign="center">
          <Spinner size="small" />
          <Text as="span" variant="bodySm" tone="subdued">Uploading…</Text>
        </InlineStack>
      ) : isBase64 ? (
        <InlineStack>
          <Button size="micro" onClick={downloadLegacy}>⬇ Download PDF</Button>
        </InlineStack>
      ) : (
        <Text as="span" variant="bodySm" tone="subdued">Not stored</Text>
      )}
    </BlockStack>
  );
}

export default function SubmissionDetail() {
  const { submission: s } = useLoaderData();
  const navigate = useNavigate();

  return (
    <Page
      title="Waiver Submission"
      backAction={{ content: "Submissions", onAction: () => navigate("/app/submissions") }}
    >
      <BlockStack gap="500">

        {/* ── Order PDF Status ── */}
        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm" tone="success">ORDER PDF</Text>

            {s.orderPdfUrl ? (
              /* PDF ready */
              <InlineGrid columns={2} gap="400">
                <Field label="Order Number" value={s.orderNumber || "—"} />
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued" fontWeight="bold" textTransform="uppercase">Waiver PDF</Text>
                  <InlineStack gap="200">
                    <Button size="micro" url={s.orderPdfUrl} external>Download PDF</Button>
                  </InlineStack>
                </BlockStack>
              </InlineGrid>
            ) : s.orderNumber ? (
              /* Order received, PDF still processing */
              <Banner tone="warning">
                Order {s.orderNumber} received — PDF is being generated, please refresh in a moment.
              </Banner>
            ) : (
              /* No order placed yet */
              <Banner tone="info">
                Customer has not placed any order yet.
              </Banner>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm" tone="info">CUSTOMER INFORMATION</Text>
            <InlineGrid columns={2} gap="400">
              <Field label="Full Legal Name"  value={s.fullName} />
              <Field label="Email"            value={s.email} />
              <Field label="Phone"            value={s.phone} />
              <Field label="Driver's License" value={s.driversLicense} />
              <Box><Field label="Street Address" value={s.streetAddress} /></Box>
              <Field label="City"  value={s.city} />
              <Field label="State" value={s.state} />
              <Field label="ZIP"   value={s.zip} />
              {s.raceClub && <Box><Field label="Race Club / League" value={s.raceClub} /></Box>}
              {s.ipAddress && <Box><Field label="IP Address" value={s.ipAddress} /></Box>}
            </InlineGrid>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm" tone="info">VEHICLE INFORMATION</Text>
            <InlineGrid columns={2} gap="400">
              <Field label="Year"  value={s.vehicleYear} />
              <Field label="Make"  value={s.vehicleMake} />
              <Field label="Model" value={s.vehicleModel} />
              <Field label="Color" value={s.vehicleColor} />
              <Box><Field label="VIN" value={s.vin} /></Box>
              <Field label="DMV Registered"        value={dash(s.dmvRegistered)} />
              <Field label="Licensed for Road Use"  value={dash(s.licensedForRoad)} />
            </InlineGrid>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm" tone="info">DOCUMENTS UPLOADED</Text>
            <InlineGrid columns={2} gap="400">
              <DocLink content={s.docTrailerUrl} filename={s.docTrailerName} />
              <DocLink content={s.docNonRoadUrl} filename={s.docNonRoadName} />
              <DocLink content={s.docEventUrl}   filename={s.docEventName} />
              {s.docClubName && <DocLink content={s.docClubUrl} filename={s.docClubName} />}
            </InlineGrid>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm" tone="info">COMPLIANCE</Text>
            <BlockStack gap="200">
              <InlineStack align="space-between"><Text as="span">Product is for racing/off-road use only</Text><YN v={s.racingUseOnly} /></InlineStack>
              <InlineStack align="space-between"><Text as="span">Vehicle not operated on public roads</Text><YN v={s.notOnPublicRoads} /></InlineStack>
              <InlineStack align="space-between"><Text as="span">Acknowledges product is not CARB approved</Text><YN v={s.notCarbApproved} /></InlineStack>
              <InlineStack align="space-between"><Text as="span">Acknowledges product is not EPA certified</Text><YN v={s.notEpaCertified} /></InlineStack>
            </BlockStack>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm" tone="info">SIGNATURE &amp; CERTIFICATION</Text>
            <InlineGrid columns={2} gap="400">
              <Field label="Printed Name" value={s.printedName} />
              <Field label="Date Signed"  value={s.signatureDate} />
            </InlineGrid>
            <BlockStack gap="200">
              <InlineStack align="space-between"><Text as="span">Understands product is not CARB approved</Text><YN v={s.certCarbApproved} /></InlineStack>
              <InlineStack align="space-between"><Text as="span">Understands product may not be EPA certified</Text><YN v={s.certEpaCertified} /></InlineStack>
              <InlineStack align="space-between"><Text as="span">Certifies racing/off-road use only (under penalty of perjury)</Text><YN v={s.certPerjury} /></InlineStack>
            </BlockStack>
            {s.digitalSignature && (
              <Box paddingBlockStart="300">
                <BlockStack gap="100">
                  <Text as="span" variant="bodySm" tone="subdued" fontWeight="bold" textTransform="uppercase">Digital Signature</Text>
                  <img
                    src={s.digitalSignature}
                    alt="Digital signature"
                    style={{ maxWidth: "320px", height: "auto", border: "1px solid #e1e3e5", borderRadius: "4px", padding: "4px", backgroundColor: "#fff" }}
                  />
                </BlockStack>
              </Box>
            )}
          </BlockStack>
        </Card>

        <Box paddingBlock="200">
          <Text as="p" variant="bodySm" tone="subdued" alignment="center">
            Shop: {s.shop} • Product: {s.productHandle} • ID: {s.id}{s.ipAddress ? ` • IP: ${s.ipAddress}` : ""}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued" alignment="center">
            Submitted: {fmt(s.createdAt)}
          </Text>
        </Box>
      </BlockStack>
    </Page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
