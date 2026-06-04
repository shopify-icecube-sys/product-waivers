import { useState, useEffect } from "react";
import { useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

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
      <s-page heading="Product Waivers">
        <s-section>
          <s-paragraph>Loading setup...</s-paragraph>
        </s-section>
      </s-page>
    );
  }

  const showBanner = appEmbedActive && !dismissedBanner;

  return (
    <s-page heading="Product Waivers">
      <style dangerouslySetInnerHTML={{
        __html: `
        /* Stepper Style - Black Theme */
        .stepper-wrapper {
          display: flex;
          justify-content: center;
          margin-bottom: 40px;
          margin-top: 10px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }

        .stepper-container {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .step-item {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .step-circle {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 2px solid #ccc;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: bold;
          transition: all 0.3s ease;
          background-color: #fff;
          color: #666;
        }

        .step-circle.active {
          border-color: #000;
          background-color: #000;
          color: #fff;
        }

        .step-circle.completed {
          border-color: #000;
          background-color: #fff;
          color: #000;
          font-size: 12px;
        }

        .step-label {
          font-size: 15px;
          font-weight: 500;
          color: #666;
          transition: all 0.3s ease;
        }

        .step-label.active {
          color: #000;
          font-weight: 700;
        }

        .step-line {
          height: 2px;
          width: 60px;
          background-color: #ccc;
          transition: all 0.3s ease;
        }

        .step-line.active {
          background-color: #000;
        }

        /* Card Container - Matte Black Accents */
        .wizard-card {
          background-color: #fff;
          border-radius: 8px;
          border: 1px solid #e1e1e1;
          padding: 24px;
          max-width: 600px;
          margin: 0 auto;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        }

        .wizard-card-header {
          font-size: 20px;
          font-weight: 600;
          color: #1a1a1a;
          margin-bottom: 12px;
        }

        .wizard-card-body {
          font-size: 14px;
          line-height: 1.5;
          color: #4a4a4a;
          margin-bottom: 20px;
        }

        /* Modern pill-style buttons */
        .btn-primary {
          background-color: #000;
          color: #fff;
          border: none;
          border-radius: 4px;
          padding: 8px 16px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: background-color 0.2s ease;
        }

        .btn-primary:hover {
          background-color: #222;
        }

        .btn-primary:disabled {
          background-color: #e1e1e1;
          color: #999;
          cursor: not-allowed;
        }

        .btn-secondary {
          background-color: #fff;
          color: #000;
          border: 1px solid #ccc;
          border-radius: 4px;
          padding: 8px 16px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: background-color 0.2s ease;
        }

        .btn-secondary:hover {
          background-color: #f6f6f6;
        }

        .btn-disabled {
          background-color: #e5e5e5;
          color: #888;
          border: 1px solid #e5e5e5;
          border-radius: 8px;
          padding: 8px 16.5px;
          font-size: 14px;
          font-weight: 500;
          cursor: not-allowed;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-right: 12px;
        }

        /* Pill-shaped Continue button like screenshot */
        .btn-pill-continue {
          background: #111;
          background-image: linear-gradient(180deg, #2a2a2a, #111);
          border: 1px solid #000;
          border-radius: 20px;
          padding: 8px 24px;
          font-size: 14px;
          font-weight: 600;
          color: #fff;
          cursor: pointer;
          box-shadow: 0 1px 3px rgba(0,0,0,0.2);
          transition: transform 0.1s ease, box-shadow 0.1s ease;
        }

        .btn-pill-continue:hover {
          background: #222;
        }

        .btn-pill-continue:disabled {
          background: #f1f1f1;
          color: #aaa;
          border-color: #e5e5e5;
          box-shadow: none;
          cursor: not-allowed;
        }

        .btn-pill-back {
          background: #fff;
          border: 1px solid #ccc;
          border-radius: 20px;
          padding: 8px 24px;
          font-size: 14px;
          font-weight: 600;
          color: #333;
          cursor: pointer;
          transition: background-color 0.2s ease, border-color 0.2s ease;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .btn-pill-back:hover {
          background: #f6f6f6;
          border-color: #adadad;
        }

        /* Alert Banner - Black style */
        .alert-banner {
          background-color: #000000;
          border: 1px solid #000000;
          border-radius: 6px;
          padding: 12px 16px;
          color: #ffffff;
          font-size: 14px;
          font-weight: 500;
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .alert-content {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .alert-icon {
          color: #ffffff;
          display: flex;
          align-items: center;
        }

        .alert-close {
          background: none;
          border: none;
          color: #ffffff;
          cursor: pointer;
          font-size: 18px;
          font-weight: bold;
          padding: 0 4px;
          display: flex;
          align-items: center;
        }

        /* Debug styling */
        .debug-box {
          margin-top: 40px;
          padding: 16px;
          background-color: #f6f6f7;
          border: 1px dashed #d1d1d6;
          border-radius: 8px;
          font-family: monospace;
          font-size: 12px;
          color: #333;
        }
      `}} />

      <div className="stepper-wrapper">
        <div className="stepper-container">
          {/* Step 1 */}
          <div className="step-item">
            <div className={`step-circle ${currentStep === 1 ? 'active' : ''} ${currentStep > 1 ? 'completed' : ''}`}>
              {currentStep > 1 ? '✓' : '1'}
            </div>
            <span className={`step-label ${currentStep === 1 ? 'active' : ''}`}>Welcome</span>
          </div>

          <div className={`step-line ${currentStep > 1 ? 'active' : ''}`}></div>

          {/* Step 2 */}
          <div className="step-item">
            <div className={`step-circle ${currentStep === 2 ? 'active' : ''} ${currentStep > 2 ? 'completed' : ''}`}>
              {currentStep > 2 ? '✓' : '2'}
            </div>
            <span className={`step-label ${currentStep === 2 ? 'active' : ''}`}>Install</span>
          </div>

          <div className={`step-line ${currentStep > 2 ? 'active' : ''}`}></div>

          {/* Step 3 */}
          <div className="step-item">
            <div className={`step-circle ${currentStep === 3 ? 'active' : ''}`}>
              3
            </div>
            <span className={`step-label ${currentStep === 3 ? 'active' : ''}`}>Waiver</span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: '20px' }}>
        {currentStep === 1 && (
          <div className="wizard-card">
            <div className="wizard-card-body" style={{ fontSize: '15px', color: '#111', padding: '16px 0', border: '1px solid #f0f0f0', borderRadius: '8px', backgroundColor: '#fdfdfd', textAlign: 'center', marginBottom: '24px' }}>
              {"Welcome to IceCube's Product Waivers Application"}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn-pill-continue" onClick={handleContinueToStep2}>
                Continue
              </button>
            </div>
          </div>
        )}

        {currentStep === 2 && (
          <div className="wizard-card">
            {showBanner && (
              <div className="alert-banner">
                <div className="alert-content">
                  <span className="alert-icon">
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="10" cy="10" r="10" fill="white" />
                      <path d="M6 10L9 13L14 7" stroke="black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span>Product Waivers script is enabled</span>
                </div>
                <button className="alert-close" onClick={() => setDismissedBanner(true)}>×</button>
              </div>
            )}

            <div className="wizard-card-header">
              Add the app to your theme
            </div>
            <div className="wizard-card-body" style={{ color: '#555' }}>
              To show the Product Waivers widget on your store, enable the Product Waivers in your Shopify theme.
              <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px', color: '#555' }}>
                <div>1. To enable the Product Waivers, click the button below.</div>
                <div>2. Click {"\"Save\""}</div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '24px' }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn-pill-back" onClick={handleBackToStep1}>
                  Back
                </button>
                {appEmbedActive ? (
                  <button className="btn-disabled" disabled>
                    App embed enabled!
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginLeft: '4px' }}>
                      <path d="M10.5 3.5H7.5M10.5 3.5V6.5M10.5 3.5L3.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                ) : (
                  <button className="btn-primary" onClick={handleEnableAppEmbed}>
                    Enable App Embed
                  </button>
                )}
              </div>
              <button
                className="btn-pill-continue"
                onClick={handleContinueToStep3}
                disabled={!appEmbedActive}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {currentStep === 3 && (
          <div className="wizard-card" style={{ borderStyle: 'dashed', backgroundColor: '#fafafa', textAlign: 'center' }}>
            <div style={{ padding: '40px 20px', display: 'flex', justifyContent: 'center' }}>
              <button className="btn-pill-back" onClick={handleBackToStep2}>
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
