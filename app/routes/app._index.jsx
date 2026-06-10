import { useState, useEffect } from "react";
import { useLoaderData, useRevalidator, Link as RemixLink } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { Page, Layout, Card, BlockStack, InlineStack, Text, Button, Banner, Box, List, Link, Icon } from "@shopify/polaris";
import { CheckIcon } from "@shopify/polaris-icons";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  let appEmbedActive = false;
  let blocks = {};
  let debugInfo = {
    step: "init",
    themesFound: [],
    mainThemeFound: false,
    fileReadStatus: "none",
    error: null,
  };

  let content = null;
  let themeId = null;

  // Strategy 1: GraphQL query
  try {
    debugInfo.step = "querying_graphql";
    const response = await admin.graphql(
      `#graphql
      query GetMainThemeSettings {
        themes(first: 10) {
          edges {
            node {
              id
              role
              name
              files(filenames: ["config/settings_data.json"]) {
                nodes {
                  filename
                  body {
                    ... on OnlineStoreThemeFileBodyText {
                      content
                    }
                  }
                }
              }
            }
          }
        }
      }`
    );

    const json = await response.json();

    if (json.errors) {
      debugInfo.error = "GraphQL Error: " + JSON.stringify(json.errors);
    } else {
      const themeEdges = json.data?.themes?.edges || [];
      debugInfo.themesFound = themeEdges.map(e => ({
        id: e.node.id,
        name: e.node.name,
        role: e.node.role
      }));

      const mainThemeNode = themeEdges.find(
        (edge) => edge.node.role.toLowerCase() === "main"
      )?.node;

      if (mainThemeNode) {
        debugInfo.mainThemeFound = true;
        const fileNode = mainThemeNode.files?.nodes?.[0];
        content = fileNode?.body?.content;
        themeId = mainThemeNode.id.split("/").pop(); // Extract numeric ID from GID string
      }
    }
  } catch (error) {
    debugInfo.error = "GraphQL Strategy Exception: " + (error.message || String(error));
    console.error("GraphQL strategy failed:", error);
  }

  // Strategy 2 Fallback: If content was not fetched via GraphQL, fetch via REST
  if (!content) {
    try {
      debugInfo.step = "fallback_rest_fetch";

      // If we don't have themeId, query list of themes first via REST
      if (!themeId) {
        const restThemesResponse = await fetch(
          `https://${session.shop}/admin/api/2026-07/themes.json`,
          {
            headers: {
              "X-Shopify-Access-Token": session.accessToken,
              "Content-Type": "application/json",
            },
          }
        );

        if (restThemesResponse.ok) {
          const themesJson = await restThemesResponse.json();
          const themes = themesJson.themes || [];
          debugInfo.themesFound = themes.map(t => ({
            id: String(t.id),
            name: t.name,
            role: t.role
          }));

          const mainTheme = themes.find(t => t.role.toLowerCase() === "main") || themes[0];
          if (mainTheme) {
            themeId = String(mainTheme.id);
            debugInfo.mainThemeFound = true;
          }
        } else {
          const errText = await restThemesResponse.text();
          throw new Error(`REST themes fetch failed: ${restThemesResponse.status} ${errText}`);
        }
      }

      if (themeId) {
        const restResponse = await fetch(
          `https://${session.shop}/admin/api/2026-07/themes/${themeId}/assets.json?asset[key]=config/settings_data.json`,
          {
            headers: {
              "X-Shopify-Access-Token": session.accessToken,
              "Content-Type": "application/json",
            },
          }
        );

        if (restResponse.ok) {
          const restJson = await restResponse.json();
          content = restJson?.asset?.value;
          debugInfo.fileReadStatus = "read_success_rest";
        } else {
          const errText = await restResponse.text();
          throw new Error(`REST asset fetch failed: ${restResponse.status} ${errText}`);
        }
      }
    } catch (error) {
      debugInfo.error = "REST Strategy Exception: " + (error.message || String(error));
      console.error("REST strategy failed:", error);
    }
  } else {
    debugInfo.fileReadStatus = "read_success_graphql";
  }

  // Parse settings file and check active blocks
  if (content) {
    try {
      // Strip block comments (/* ... */) which Shopify includes in settings_data.json
      const stripped = content.replace(/\/\*[\s\S]*?\*\//g, "").trim();
      const settingsJson = JSON.parse(stripped);
      blocks = settingsJson?.current?.blocks || {};

      // Store raw block types in debug to help identify the correct identifier
      debugInfo.rawBlockTypes = Object.entries(blocks).map(([key, block]) => ({
        key,
        type: block?.type,
        disabled: block?.disabled,
      }));

      for (const [key, block] of Object.entries(blocks)) {
        const type = block?.type || "";
        // Match any block that belongs to the Product Waivers app by handle or client ID
        if (
          type.includes("product-waivers") ||
          type.includes("f0d6b321c4656f11dfeb7953d26abff6") ||
          key.includes("product-waivers") ||
          key.includes("f0d6b321c4656f11dfeb7953d26abff6")
        ) {
          if (block.disabled === false) {
            appEmbedActive = true;
            break;
          }
        }
      }
    } catch (error) {
      debugInfo.error = "JSON parse exception: " + (error.message || String(error));
      console.error("JSON parse failed:", error);
    }
  }

  return {
    shop: session.shop,
    appEmbedActive,
    blocks,
    debugInfo
  };
};

export default function Index() {
  const { shop, appEmbedActive } = useLoaderData();
  const revalidator = useRevalidator();

  const [currentStep, setCurrentStep] = useState(1);
  const [dismissedBanner, setDismissedBanner] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const savedStep = localStorage.getItem("currentStep");
    if (savedStep) {
      setCurrentStep(parseInt(savedStep, 10));
    }
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    const handleFocus = () => {
      revalidator.revalidate();
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [revalidator]);

  const handleContinueToStep2 = () => {
    setCurrentStep(2);
    localStorage.setItem("currentStep", "2");
  };

  const handleEnableAppEmbed = () => {
    const editorUrl = `https://${shop}/admin/themes/current/editor?context=apps`;
    window.open(editorUrl, "_top");
  };

  const handleContinueToStep3 = () => {
    setCurrentStep(3);
    localStorage.setItem("currentStep", "3");
  };

  const handleBackToStep1 = () => {
    setCurrentStep(1);
    localStorage.setItem("currentStep", "1");
  };

  const handleBackToStep2 = () => {
    setCurrentStep(2);
    localStorage.setItem("currentStep", "2");
  };


  if (!isLoaded) {
    return (
      <Page title="Product Waivers">
        <Layout>
          <Layout.Section>
            <Card>
              <Text as="p">Loading setup...</Text>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const showBanner = appEmbedActive && !dismissedBanner;

  return (
    <Page title="Product Waivers" titleHidden>
      <Layout>
        <Layout.Section>
          <BlockStack gap="500" inlineAlign="center">

            {/* Stepper implementation */}
            <Box paddingBlockEnd="400">
              <InlineStack gap="400" align="center" blockAlign="center">
                <InlineStack gap="200" align="center">
                  <Box
                    background="bg-fill-inverse"
                    borderColor="border-inverse"
                    borderWidth="025"
                    borderRadius="full"
                    padding="100"
                    minWidth="32px"
                    minHeight="32px"
                  >
                    <InlineStack align="center" blockAlign="center">
                      {currentStep > 1 ? (
                        <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '16px', lineHeight: 1 }}>✓</span>
                      ) : (
                        <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '14px' }}>1</span>
                      )}
                    </InlineStack>
                  </Box>
                  <Text as="span" variant="bodyMd" fontWeight={currentStep === 1 ? "bold" : "regular"} tone={currentStep === 1 ? "base" : "subdued"}>Welcome</Text>
                </InlineStack>

                <Box minWidth="60px" minHeight="2px" background={currentStep >= 2 ? "bg-fill-inverse" : "bg-surface-disabled"} />

                <InlineStack gap="200" align="center">
                  <Box
                    background="bg-fill-inverse"
                    borderColor="border-inverse"
                    borderWidth="025"
                    borderRadius="full"
                    padding="100"
                    minWidth="32px"
                    minHeight="32px"
                  >
                    <InlineStack align="center" blockAlign="center">
                      {currentStep > 2 ? (
                        <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '16px', lineHeight: 1 }}>✓</span>
                      ) : (
                        <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '14px' }}>2</span>
                      )}
                    </InlineStack>
                  </Box>
                  <Text as="span" variant="bodyMd" fontWeight={currentStep === 2 ? "bold" : "regular"} tone={currentStep === 2 ? "base" : "subdued"}>Install</Text>
                </InlineStack>

                <Box minWidth="60px" minHeight="2px" background={currentStep >= 3 ? "bg-fill-inverse" : "bg-surface-disabled"} />

                <InlineStack gap="200" align="center">
                  <Box
                    background="bg-fill-inverse"
                    borderColor="border-inverse"
                    borderWidth="025"
                    borderRadius="full"
                    padding="100"
                    minWidth="32px"
                    minHeight="32px"
                  >
                    <InlineStack align="center" blockAlign="center">
                      <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '14px' }}>3</span>
                    </InlineStack>
                  </Box>
                  <Text as="span" variant="bodyMd" fontWeight={currentStep === 3 ? "bold" : "regular"} tone={currentStep === 3 ? "base" : "subdued"}>Waiver</Text>
                </InlineStack>
              </InlineStack>
            </Box>

            <Box width="100%" maxWidth="600px">
              {currentStep === 1 && (
                <Card>
                  <BlockStack gap="400">
                    <Box padding="400" background="bg-surface-secondary" borderRadius="200" borderColor="border" borderWidth="025">
                      <Text as="p" alignment="center" variant="bodyLg">
                        Welcome to IceCube&apos;s Product Waivers Application
                      </Text>
                    </Box>
                    <InlineStack align="center">
                      <Button variant="primary" onClick={handleContinueToStep2}>
                        Continue
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              )}

              {currentStep === 2 && (
                <BlockStack gap="400">
                  {showBanner && (
                    <Banner tone="success" onDismiss={() => setDismissedBanner(true)}>
                      <Text as="p">Product Waivers script is enabled</Text>
                    </Banner>
                  )}

                  <Card>
                    <BlockStack gap="400">
                      <Text as="h2" variant="headingLg">Add the app to your theme</Text>
                      <Text as="p" tone="subdued">
                        To show the Product Waivers widget on your store, enable the Product Waivers in your Shopify theme.
                      </Text>
                      <List type="number">
                        <List.Item>To enable the Product Waivers, click the button below.</List.Item>
                        <List.Item>Click &quot;Save&quot;</List.Item>
                      </List>

                      <InlineStack align="space-between" blockAlign="center">
                        <InlineStack gap="300">
                          <Button onClick={handleBackToStep1}>Back</Button>
                          {appEmbedActive ? (
                            <Button disabled icon={CheckIcon}>
                              App embed enabled!
                            </Button>
                          ) : (
                            <Button variant="primary" onClick={handleEnableAppEmbed}>
                              Enable App Embed
                            </Button>
                          )}
                        </InlineStack>
                        <Button
                          variant="primary"
                          onClick={handleContinueToStep3}
                          disabled={!appEmbedActive}
                        >
                          Continue
                        </Button>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                </BlockStack>
              )}

              {currentStep === 3 && (
                <Card background="bg-surface-secondary">
                  <BlockStack gap="400" inlineAlign="center">
                    <Text as="p" variant="bodyMd" alignment="center">
                      Please check your Form Submissions{' '}
                      <RemixLink to="/app/submissions">
                        <Link as="span" monochrome>here</Link>
                      </RemixLink>
                    </Text>
                    <Text as="p" variant="bodyMd" alignment="center">
                      Please check your app Setting to modify the appearance from{' '}
                      <RemixLink to="/app/settings">
                        <Link as="span" monochrome>here</Link>
                      </RemixLink>
                    </Text>

                    <Box width="100%" padding="400" background="bg-surface" borderRadius="200" borderColor="border" borderWidth="025">
                      <BlockStack gap="300">
                        <Text as="h3" variant="headingSm" alignment="center">How It Works:</Text>
                        <List type="bullet">
                          <List.Item><strong>Important:</strong> The waiver form will only appear on products that have the product metafield <Text as="span" fontWeight="bold">Requires Race Waiver</Text> set to <Text as="span" fontWeight="bold">True</Text>.</List.Item>
                          <List.Item>When a customer tries to add a product requiring a waiver to their cart, a popup modal will appear automatically.</List.Item>
                          <List.Item>The customer must fill out their details, vehicle information, upload necessary documents, and sign the waiver digitally.</List.Item>
                          <List.Item>Once completed and submitted, the product is added to their cart, and the signed waiver is securely saved.</List.Item>
                          <List.Item>You can view, manage, and download all signed waivers from the <strong>Form Submissions</strong> page.</List.Item>
                        </List>
                      </BlockStack>
                    </Box>

                    <Button onClick={handleBackToStep2}>Back</Button>
                  </BlockStack>
                </Card>
              )}
            </Box>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
