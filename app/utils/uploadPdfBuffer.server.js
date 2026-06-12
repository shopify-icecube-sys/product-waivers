/**
 * Uploads a PDF Buffer to Shopify Content → Files via staged upload.
 * Returns the CDN URL of the uploaded file.
 */
export async function uploadPdfBuffer(admin, buffer, filename) {
  // 1. Request a staged upload target
  const stagedRes = await admin.graphql(
    `#graphql
    mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets {
          url
          resourceUrl
          parameters { name value }
        }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        input: [{
          filename,
          mimeType:   "application/pdf",
          httpMethod: "POST",
          resource:   "FILE",
          fileSize:   String(buffer.length),
        }],
      },
    }
  );

  const stagedJson   = await stagedRes.json();
  const stagedErrors = stagedJson.data?.stagedUploadsCreate?.userErrors;
  if (stagedErrors?.length) throw new Error(stagedErrors[0].message);

  const target = stagedJson.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) throw new Error("No staged upload target returned");

  // 2. POST binary to the staged URL (Google Cloud Storage)
  const form = new FormData();
  for (const { name, value } of target.parameters) form.append(name, value);
  form.append("file", new Blob([buffer], { type: "application/pdf" }), filename);

  const uploadRes = await fetch(target.url, { method: "POST", body: form });
  if (!uploadRes.ok) throw new Error(`Staged upload failed: HTTP ${uploadRes.status}`);

  // 3. Register in Shopify Content → Files
  const fileRes = await admin.graphql(
    `#graphql
    mutation fileCreate($files: [FileCreateInput!]!) {
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

  const fileJson   = await fileRes.json();
  const fileErrors = fileJson.data?.fileCreate?.userErrors;
  if (fileErrors?.length) throw new Error(fileErrors[0].message);

  const file = fileJson.data?.fileCreate?.files?.[0];
  return file?.url || target.resourceUrl || null;
}
