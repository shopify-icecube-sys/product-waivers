import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useState, useCallback } from "react";
import { Form, useActionData, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";
import { Page, Card, FormLayout, TextField, Button, Text, BlockStack, AppProvider as PolarisAppProvider } from "@shopify/polaris";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  const errors = loginErrorMessage(await login(request));

  return { errors };
};

export const action = async ({ request }) => {
  const errors = loginErrorMessage(await login(request));

  return {
    errors,
  };
};

export default function Auth() {
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const [shop, setShop] = useState("");
  const { errors } = actionData || loaderData || {};

  const handleShopChange = useCallback((value) => setShop(value), []);

  return (
    <PolarisAppProvider i18n={polarisTranslations}>
      <AppProvider embedded={false}>
        <Page>
          <Card>
            <BlockStack gap="400">
              <Text as="h1" variant="headingLg">Log in</Text>
              <Form method="post">
                <FormLayout>
                  <TextField
                    name="shop"
                    label="Shop domain"
                    helpText="example.myshopify.com"
                    value={shop}
                    onChange={handleShopChange}
                    autoComplete="on"
                    error={errors?.shop}
                  />
                  <Button submit variant="primary">Log in</Button>
                </FormLayout>
              </Form>
            </BlockStack>
          </Card>
        </Page>
      </AppProvider>
    </PolarisAppProvider>
  );
}
