/* eslint-disable react/prop-types */
import { useState, useCallback } from "react";
import { useLoaderData, useSubmit, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import {
  Page, Layout, Card, IndexTable, Pagination, Button, Modal,
  Text, BlockStack, InlineStack, Badge, Box,
} from "@shopify/polaris";

const PER_PAGE = 25;

/* ── PDF fields definition ── */
const PDF_FIELDS = [
  { contentKey: "docTrailerUrl", nameKey: "docTrailerName" },
  { contentKey: "docNonRoadUrl", nameKey: "docNonRoadName" },
  { contentKey: "docEventUrl",   nameKey: "docEventName"   },
  { contentKey: "docClubUrl",    nameKey: "docClubName"    },
];

/* ── Shopify Files upload ── */

async function uploadPdfToShopify(admin, base64DataUrl, filename) {
  const match = base64DataUrl.match(/^data:[^;]+;base64,([\s\S]+)$/);
  if (!match) throw new Error("Invalid base64 data URL");

  // atob is a global in Node.js 18+ and all browsers — no Buffer import needed
  const binaryStr = atob(match[1].trim());
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

  // 1. Request a staged upload target
  const stagedRes = await admin.graphql(
    `mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        input: [{
          filename,
          mimeType: "application/pdf",
          httpMethod: "POST",
          resource: "FILE",
          fileSize: String(bytes.length),
        }],
      },
    }
  );

  const stagedJson = await stagedRes.json();
  const stagedErrors = stagedJson.data?.stagedUploadsCreate?.userErrors;
  if (stagedErrors?.length) throw new Error(stagedErrors[0].message);

  const target = stagedJson.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) throw new Error("No staged upload target returned");

  // 2. POST binary to the staged URL (Google Cloud Storage)
  const form = new FormData();
  for (const { name, value } of target.parameters) form.append(name, value);
  form.append("file", new Blob([bytes], { type: "application/pdf" }), filename);

  const uploadRes = await fetch(target.url, { method: "POST", body: form });
  if (!uploadRes.ok) throw new Error(`Staged upload HTTP ${uploadRes.status}`);

  // 3. Register in Shopify Content → Files
  const fileRes = await admin.graphql(
    `mutation fileCreate($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files { ... on GenericFile { id url fileStatus } }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        files: [{ originalSource: target.resourceUrl, contentType: "FILE" }],
      },
    }
  );

  const fileJson = await fileRes.json();
  const fileErrors = fileJson.data?.fileCreate?.userErrors;
  if (fileErrors?.length) throw new Error(fileErrors[0].message);

  const file = fileJson.data?.fileCreate?.files?.[0];
  return file?.url || target.resourceUrl || null;
}

/* Upload all base64 PDFs for one submission, then write URLs back to DB.
   Uses an "__uploading__" sentinel to prevent concurrent duplicate uploads. */
async function processSubmission(admin, submission) {
  const toUpload = PDF_FIELDS.filter(
    ({ contentKey }) => submission[contentKey]?.startsWith("data:")
  );
  if (toUpload.length === 0) return;

  await db.waiverSubmission.update({
    where: { id: submission.id },
    data: Object.fromEntries(toUpload.map(({ contentKey }) => [contentKey, "__uploading__"])),
  });

  const updates = {};
  await Promise.allSettled(
    toUpload.map(async ({ contentKey, nameKey }) => {
      const originalName    = submission[nameKey] || "document.pdf";
      const originalContent = submission[contentKey]; // preserve base64 before sentinel overwrites it
      try {
        const url = await uploadPdfToShopify(admin, originalContent, originalName);
        updates[contentKey] = url?.startsWith("http") ? url : originalContent;
      } catch (e) {
        console.warn(`[Submissions] Upload failed for ${originalName}:`, e?.message);
        updates[contentKey] = originalContent; // restore original — never lose the file data
      }
    })
  );

  await db.waiverSubmission.update({ where: { id: submission.id }, data: updates });
}

/* ── Loader ── */

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const url  = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));

  const [total, rawSubmissions] = await Promise.all([
    db.waiverSubmission.count(),
    db.waiverSubmission.findMany({
      orderBy: { createdAt: "desc" },
      skip:  (page - 1) * PER_PAGE,
      take:  PER_PAGE,
    }),
  ]);

  const needsUpload = rawSubmissions.filter(s =>
    PDF_FIELDS.some(({ contentKey }) => s[contentKey]?.startsWith("data:"))
  );

  if (needsUpload.length === 0) {
    return { submissions: rawSubmissions, total, page };
  }

  await Promise.allSettled(needsUpload.map(s => processSubmission(admin, s)));

  const submissions = await db.waiverSubmission.findMany({
    orderBy: { createdAt: "desc" },
    skip:  (page - 1) * PER_PAGE,
    take:  PER_PAGE,
  });

  return { submissions, total, page };
};

/* ── Action ── */

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  if (formData.get("_action") === "clearAll") {
    await db.waiverSubmission.deleteMany({});
  }
  return { ok: true };
};

/* ── UI helpers ── */

function fmt(d) {
  return new Date(d).toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/* ── Page component ── */

export default function FormSubmissions() {
  const { submissions, total, page } = useLoaderData();
  const [showClearModal, setShowClearModal] = useState(false);
  const submit   = useSubmit();
  const navigate = useNavigate();

  const handleClearConfirm = useCallback(() => {
    setShowClearModal(false);
    submit({ _action: "clearAll" }, { method: "post" });
  }, [submit]);

  const totalPages = Math.ceil(total / PER_PAGE);

  const rowMarkup = submissions.map((s, index) => (
    <IndexTable.Row id={s.id} key={s.id} position={index}>
      <IndexTable.Cell>
        <Text variant="bodyMd" fontWeight="bold" as="span">{(page - 1) * PER_PAGE + index + 1}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{fmt(s.createdAt)}</IndexTable.Cell>
      <IndexTable.Cell><Text fontWeight="bold" as="span">{s.fullName}</Text></IndexTable.Cell>
      <IndexTable.Cell>{s.email}</IndexTable.Cell>
      <IndexTable.Cell>{s.phone}</IndexTable.Cell>
      <IndexTable.Cell><Badge tone="info">{s.productHandle}</Badge></IndexTable.Cell>
      <IndexTable.Cell>{s.vehicleYear} {s.vehicleMake} {s.vehicleModel}</IndexTable.Cell>
      <IndexTable.Cell>
        <Button size="micro" onClick={() => navigate(`/app/submissions/${s.id}`)}>Details</Button>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title="Form Submissions"
      primaryAction={total > 0 ? {
        content: "Clear All Submissions",
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
                  { title: "#" },
                  { title: "Submitted" },
                  { title: "Full Name" },
                  { title: "Email" },
                  { title: "Phone" },
                  { title: "Product" },
                  { title: "Vehicle" },
                  { title: "" },
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

      <Modal
        open={showClearModal}
        onClose={() => setShowClearModal(false)}
        title="Clear all submissions?"
        primaryAction={{
          content: "Yes, delete all",
          destructive: true,
          onAction: handleClearConfirm,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setShowClearModal(false) }]}
      >
        <Modal.Section>
          <Text as="p">
            This will permanently delete all <strong>{total}</strong> submission{total !== 1 ? "s" : ""}.
            This action cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>

      <Box paddingBlockStart="400">
        <Button onClick={() => navigate("/app")}>Back</Button>
      </Box>
    </Page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
