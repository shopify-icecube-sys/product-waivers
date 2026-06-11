/* eslint-disable react/prop-types */
import { useLoaderData, useNavigate } from "react-router";
import { redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  Page, Card, Button, Text, BlockStack, InlineStack,
  Box, InlineGrid, Spinner,
} from "@shopify/polaris";

export const loader = async ({ request, params }) => {
  await authenticate.admin(request);
  const submission = await db.waiverSubmission.findUnique({
    where: { id: params.id },
  });
  if (!submission) throw redirect("/app/submissions");
  return { submission };
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
        <Card>
          <BlockStack gap="300">
            <Text as="h3" variant="headingSm" tone="info">CUSTOMER INFORMATION</Text>
            <InlineGrid columns={2} gap="400">
              <Field label="Full Legal Name"  value={s.fullName} />
              <Field label="Email"            value={s.email} />
              <Field label="Phone"            value={s.phone} />
              <Field label="Driver's License" value={s.driversLicense} />
              <Box gridColumn="span 2"><Field label="Street Address" value={s.streetAddress} /></Box>
              <Field label="City"  value={s.city} />
              <Field label="State" value={s.state} />
              <Field label="ZIP"   value={s.zip} />
              {s.raceClub && <Box gridColumn="span 2"><Field label="Race Club / League" value={s.raceClub} /></Box>}
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
              <Box gridColumn="span 2"><Field label="VIN" value={s.vin} /></Box>
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
            Shop: {s.shop} • Product: {s.productHandle} • ID: {s.id} • Submitted: {fmt(s.createdAt)}
          </Text>
        </Box>
      </BlockStack>
    </Page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
