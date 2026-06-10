import { useState } from "react";
import { useLoaderData, useActionData, useNavigation, Form, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Retrieve existing settings from Prisma
  let settings = await db.appSetting.findUnique({
    where: { shop },
  });

  if (!settings) {
    settings = await db.appSetting.create({
      data: { shop, buttonColor: "#2563eb", progressColor: "#2563eb" },
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

  const isSaving = navigation.state === "submitting";

  const [buttonColor, setButtonColor] = useState(settings?.buttonColor || "#2563eb");
  const [progressColor, setProgressColor] = useState(settings?.progressColor || "#2563eb");

  return (
    <s-page heading="Settings">
      <div style={{ maxWidth: "600px", margin: "0 auto" }}>
        
        {actionData?.success && (
          <div style={{ marginBottom: "20px", padding: "12px", backgroundColor: "#e6f4ea", color: "#1e4620", borderRadius: "8px", border: "1px solid #cce8d6", fontSize: "14px", fontWeight: "500" }}>
            Settings successfully saved! They will now appear on your storefront form.
          </div>
        )}

        {actionData?.errors && (
          <div style={{ marginBottom: "20px", padding: "12px", backgroundColor: "#fce8e6", color: "#c5221f", borderRadius: "8px", border: "1px solid #fad2cf", fontSize: "14px", fontWeight: "500" }}>
            Error saving settings to Shopify. Please try again.
          </div>
        )}

        <div style={{ padding: "24px", backgroundColor: "#fff", borderRadius: "12px", border: "1px solid #e1e3e5", boxShadow: "0 2px 4px rgba(0,0,0,0.02)" }}>
          <div style={{ marginBottom: "20px" }}>
            <h2 style={{ margin: "0 0 8px 0", fontSize: "18px", fontWeight: "600", color: "#202223" }}>Storefront Form Design</h2>
            <p style={{ margin: "0", fontSize: "14px", color: "#6d7175" }}>
              Customize the look and feel of the Product Waivers widget to match your brand.
            </p>
          </div>

          <Form method="post">
            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              
              {/* Button Color Setting */}
              <div>
                <label htmlFor="buttonColor" style={{ display: "block", fontSize: "14px", fontWeight: "500", color: "#202223", marginBottom: "8px" }}>
                  Primary Button Color
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <input
                    type="color"
                    id="buttonColor"
                    name="buttonColor"
                    value={buttonColor}
                    onChange={(e) => setButtonColor(e.target.value)}
                    style={{ width: "40px", height: "40px", padding: "0", border: "1px solid #e1e3e5", borderRadius: "4px", cursor: "pointer" }}
                  />
                  <input
                    type="text"
                    value={buttonColor}
                    onChange={(e) => setButtonColor(e.target.value)}
                    style={{ flex: 1, padding: "8px 12px", border: "1px solid #c9cccf", borderRadius: "4px", fontSize: "14px" }}
                    placeholder="#2563eb"
                  />
                </div>
              </div>

              {/* Progress Color Setting */}
              <div>
                <label htmlFor="progressColor" style={{ display: "block", fontSize: "14px", fontWeight: "500", color: "#202223", marginBottom: "8px" }}>
                  Progress Indicator Color
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <input
                    type="color"
                    id="progressColor"
                    name="progressColor"
                    value={progressColor}
                    onChange={(e) => setProgressColor(e.target.value)}
                    style={{ width: "40px", height: "40px", padding: "0", border: "1px solid #e1e3e5", borderRadius: "4px", cursor: "pointer" }}
                  />
                  <input
                    type="text"
                    value={progressColor}
                    onChange={(e) => setProgressColor(e.target.value)}
                    style={{ flex: 1, padding: "8px 12px", border: "1px solid #c9cccf", borderRadius: "4px", fontSize: "14px" }}
                    placeholder="#2563eb"
                  />
                </div>
              </div>

              {/* Live Preview */}
              <div style={{ marginTop: "12px", padding: "20px", backgroundColor: "#f6f6f7", borderRadius: "8px", border: "1px dashed #c9cccf" }}>
                <div style={{ fontSize: "13px", fontWeight: "600", color: "#6d7175", marginBottom: "16px", textTransform: "uppercase" }}>Preview</div>
                
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px" }}>
                  <div style={{ width: "24px", height: "24px", borderRadius: "50%", backgroundColor: progressColor, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: "bold" }}>1</div>
                  <div style={{ flex: 1, height: "2px", backgroundColor: progressColor }}></div>
                  <div style={{ width: "24px", height: "24px", borderRadius: "50%", backgroundColor: "#d1d5db", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: "bold" }}>2</div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button 
                    type="button" 
                    style={{ 
                      padding: "8px 20px", 
                      backgroundColor: buttonColor, 
                      color: "#fff", 
                      border: "none", 
                      borderRadius: "6px", 
                      fontWeight: "500", 
                      cursor: "pointer" 
                    }}>
                    Next Step
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "8px" }}>
                <button
                  type="submit"
                  disabled={isSaving}
                  style={{
                    backgroundColor: "#000",
                    color: "#fff",
                    border: "none",
                    padding: "10px 24px",
                    borderRadius: "4px",
                    fontWeight: "600",
                    fontSize: "14px",
                    cursor: isSaving ? "not-allowed" : "pointer",
                    opacity: isSaving ? 0.7 : 1,
                  }}
                >
                  {isSaving ? "Saving..." : "Save Settings"}
                </button>
              </div>

            </div>
          </Form>
        </div>
      </div>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
