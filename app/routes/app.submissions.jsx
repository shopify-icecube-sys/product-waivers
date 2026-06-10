/* eslint-disable react/prop-types */
import { useState, useCallback } from "react";
import { useLoaderData, useSubmit, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { Page, Layout, Card, IndexTable, Pagination, Button, Modal, Text, BlockStack, InlineStack, Badge, Box, InlineGrid } from "@shopify/polaris";

const PER_PAGE = 25;

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const url  = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));

  const [total, submissions] = await Promise.all([
    db.waiverSubmission.count(),
    db.waiverSubmission.findMany({
      orderBy: { createdAt: "desc" },
      skip:  (page - 1) * PER_PAGE,
      take:  PER_PAGE,
    }),
  ]);

  return { submissions, total, page };
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  if (formData.get("_action") === "clearAll") {
    await db.waiverSubmission.deleteMany({});
  }
  return { ok: true };
};

/* ── helpers ── */
function fmt(d) {
  return new Date(d).toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
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

function DownloadBtn({ content, filename }) {
  if (!filename) return <Text as="span">—</Text>;
  const download = () => {
    if (!content) return;
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
      {content ? (
        <InlineStack>
          <Button size="micro" onClick={download}>⬇ Download PDF</Button>
        </InlineStack>
      ) : (
        <Text as="span" variant="bodySm" tone="subdued">Not stored</Text>
      )}
    </BlockStack>
  );
}

function Detail({ s }) {
  return (
    <BlockStack gap="500">
      <Card>
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm" tone="info">CUSTOMER INFORMATION</Text>
          <InlineGrid columns={2} gap="400">
            <Field label="Full Legal Name" value={s.fullName} />
            <Field label="Email" value={s.email} />
            <Field label="Phone" value={s.phone} />
            <Field label="Driver's License" value={s.driversLicense} />
            <Box gridColumn="span 2"><Field label="Street Address" value={s.streetAddress} /></Box>
            <Field label="City" value={s.city} />
            <Field label="State" value={s.state} />
            <Field label="ZIP" value={s.zip} />
            {s.raceClub && <Box gridColumn="span 2"><Field label="Race Club / League" value={s.raceClub} /></Box>}
          </InlineGrid>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm" tone="info">VEHICLE INFORMATION</Text>
          <InlineGrid columns={2} gap="400">
            <Field label="Year" value={s.vehicleYear} />
            <Field label="Make" value={s.vehicleMake} />
            <Field label="Model" value={s.vehicleModel} />
            <Field label="Color" value={s.vehicleColor} />
            <Box gridColumn="span 2"><Field label="VIN" value={s.vin} /></Box>
            <Field label="DMV Registered" value={dash(s.dmvRegistered)} />
            <Field label="Licensed for Road Use" value={dash(s.licensedForRoad)} />
          </InlineGrid>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="300">
          <Text as="h3" variant="headingSm" tone="info">DOCUMENTS UPLOADED</Text>
          <InlineGrid columns={2} gap="400">
            <DownloadBtn content={s.docTrailerContent} filename={s.docTrailerName} />
            <DownloadBtn content={s.docNonRoadContent} filename={s.docNonRoadName} />
            <DownloadBtn content={s.docEventContent} filename={s.docEventName} />
            {s.docClubName && <DownloadBtn content={s.docClubContent} filename={s.docClubName} />}
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
            <Field label="Date Signed" value={s.signatureDate} />
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
                <img src={s.digitalSignature} alt="Digital signature" style={{ maxWidth: '320px', height: 'auto', border: '1px solid #e1e3e5', borderRadius: '4px', padding: '4px', backgroundColor: '#fff' }} />
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
  );
}

export default function FormSubmissions() {
  const { submissions, total, page } = useLoaderData();
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [showClearModal, setShowClearModal] = useState(false);
  const submit = useSubmit();
  const navigate = useNavigate();

  const handleClearConfirm = useCallback(() => {
    setShowClearModal(false);
    submit({ _action: "clearAll" }, { method: "post" });
  }, [submit]);

  const totalPages = Math.ceil(total / PER_PAGE);

  const rowMarkup = submissions.map((s, index) => (
    <IndexTable.Row
      id={s.id}
      key={s.id}
      position={index}
    >
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="bold" as="span">{(page - 1) * PER_PAGE + index + 1}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{fmt(s.createdAt)}</IndexTable.Cell>
      <IndexTable.Cell><Text fontWeight="bold" as="span">{s.fullName}</Text></IndexTable.Cell>
      <IndexTable.Cell>{s.email}</IndexTable.Cell>
      <IndexTable.Cell>{s.phone}</IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone="info">{s.productHandle}</Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>{s.vehicleYear} {s.vehicleMake} {s.vehicleModel}</IndexTable.Cell>
      <IndexTable.Cell>
        <Button size="micro" onClick={() => setSelectedSubmission(s)}>Details</Button>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page 
      title="Form Submissions"
      primaryAction={total > 0 ? {
        content: 'Clear All Submissions',
        destructive: true,
        onAction: () => setShowClearModal(true),
      } : undefined}
    >
      <Layout>
        <Layout.Section>
          {total === 0 ? (
            <Card>
              <BlockStack gap="400" inlineAlign="center">
                <Box padding="600" textAlign="center">
                  <Text as="h2" variant="headingMd">No submissions yet</Text>
                  <Text as="p" tone="subdued">Completed waiver forms will appear here automatically.</Text>
                </Box>
              </BlockStack>
            </Card>
          ) : (
            <Card padding="0">
              <IndexTable
                itemCount={submissions.length}
                headings={[
                  { title: '#' },
                  { title: 'Submitted' },
                  { title: 'Full Name' },
                  { title: 'Email' },
                  { title: 'Phone' },
                  { title: 'Product' },
                  { title: 'Vehicle' },
                  { title: '' },
                ]}
                selectable={false}
              >
                {rowMarkup}
              </IndexTable>
              
              {totalPages > 1 && (
                <Box padding="400">
                  <InlineStack align="center">
                    <Pagination
                      hasPrevious={page > 1}
                      onPrevious={() => navigate(`?page=${page - 1}`)}
                      hasNext={page < totalPages}
                      onNext={() => navigate(`?page=${page + 1}`)}
                      label={`Page ${page} of ${totalPages}`}
                    />
                  </InlineStack>
                </Box>
              )}
            </Card>
          )}
        </Layout.Section>
      </Layout>

      {/* Submission Detail Modal */}
      {selectedSubmission && (
        <Modal
          open={!!selectedSubmission}
          onClose={() => setSelectedSubmission(null)}
          title={`Waiver Submission`}
          size="large"
          primaryAction={{
            content: 'Close',
            onAction: () => setSelectedSubmission(null),
          }}
        >
          <Modal.Section>
            <Detail s={selectedSubmission} />
          </Modal.Section>
        </Modal>
      )}

      {/* Clear All Confirmation Modal */}
      <Modal
        open={showClearModal}
        onClose={() => setShowClearModal(false)}
        title="Clear all submissions?"
        primaryAction={{
          content: 'Yes, delete all',
          destructive: true,
          onAction: handleClearConfirm,
        }}
        secondaryActions={[
          {
            content: 'Cancel',
            onAction: () => setShowClearModal(false),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            This will permanently delete all <strong>{total}</strong> submission{total !== 1 ? "s" : ""}. 
            This action cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>
        <Box paddingBlockStart="400">
          <Button onClick={() => navigate('/app')}>Back</Button>
        </Box>
    </Page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
