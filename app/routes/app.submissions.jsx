import { Outlet } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

export default function SubmissionsLayout() {
  return <Outlet />;
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
