import { useState, useCallback } from "react";
import { useLoaderData, useActionData, useNavigation, Form, useRouteError, useSubmit, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { Page, Layout, Card, BlockStack, Text, FormLayout, TextField, Button, Banner, Box, InlineStack, Divider } from "@shopify/polaris";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Retrieve existing settings from Prisma
  let settings = await db.appSetting.findUnique({
    where: { shop },
  });

  if (!settings) {
    settings = await db.appSetting.create({
      data: { shop, buttonColor: "#000000", progressColor: "#fcfbfbff" },
    });
  }

  return { settings };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const buttonColor = formData.get("buttonColor");
  const progressColor = formData.get("progressColor");

  // Save to Prisma
  await db.appSetting.upsert({
    where: { shop },
    update: { buttonColor, progressColor },
    create: { shop, buttonColor, progressColor },
  });

  // Save to Shopify Shop Metafields
  // Get Shop ID
  const shopQuery = await admin.graphql(`
    query {
      shop {
        id
      }
    }
  `);
  const shopJson = await shopQuery.json();
  const shopId = shopJson.data.shop.id;

  // Set Metafield
  const response = await admin.graphql(
    `#graphql
    mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId: shopId,
            namespace: "product_waivers",
            key: "settings",
            type: "json",
            value: JSON.stringify({ buttonColor, progressColor }),
          },
        ],
      },
    }
  );

  const metaJson = await response.json();

  if (metaJson.data?.metafieldsSet?.userErrors?.length > 0) {
    return { success: false, errors: metaJson.data.metafieldsSet.userErrors };
  }

  return { success: true };
};

export default function Settings() {
  const { settings } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();

  const isSaving = navigation.state === "submitting";
  const navigate = useNavigate();

  const [buttonColor, setButtonColor] = useState(settings?.buttonColor || "#2563eb");
  const [progressColor, setProgressColor] = useState(settings?.progressColor || "#2563eb");

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    submit({ buttonColor, progressColor }, { method: "post" });
  }, [buttonColor, progressColor, submit]);

  return (
    <Page title="Settings">
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {actionData?.success && (
              <Banner tone="success">
                <Text as="p">Settings successfully saved! They will now appear on your storefront form.</Text>
              </Banner>
            )}

            {actionData?.errors && (
              <Banner tone="critical">
                <Text as="p">Error saving settings to Shopify. Please try again.</Text>
              </Banner>
            )}

            <Card>
              <BlockStack gap="500">
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">Storefront Form Design</Text>
                  <Text as="p" tone="subdued">
                    Customize the look and feel of the Product Waivers widget to match your brand.
                  </Text>
                </BlockStack>

                <Form onSubmit={handleSubmit} method="post">
                  <FormLayout>
                    <FormLayout.Group>
                      <TextField
                        label="Primary Button Color"
                        type="text"
                        value={buttonColor}
                        onChange={setButtonColor}
                        autoComplete="off"
                        connectedLeft={
                          <input
                            type="color"
                            value={buttonColor}
                            onChange={(e) => setButtonColor(e.target.value)}
                            style={{ width: "38px", height: "38px", padding: 0, border: "none", cursor: "pointer", background: "transparent" }}
                          />
                        }
                      />
                      <TextField
                        label="Progress Indicator Color"
                        type="text"
                        value={progressColor}
                        onChange={setProgressColor}
                        autoComplete="off"
                        connectedLeft={
                          <input
                            type="color"
                            value={progressColor}
                            onChange={(e) => setProgressColor(e.target.value)}
                            style={{ width: "38px", height: "38px", padding: 0, border: "none", cursor: "pointer", background: "transparent" }}
                          />
                        }
                      />
                    </FormLayout.Group>

                    <InlineStack align="end" gap="300">
                      <Button onClick={() => navigate('/app')}>Back</Button>
                      <Button submit variant="primary" loading={isSaving}>
                        Save Settings
                      </Button>
                    </InlineStack>
                  </FormLayout>
                </Form>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
