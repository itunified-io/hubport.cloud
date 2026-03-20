import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { AuthProvider } from "./auth/AuthProvider";
import { PermissionProvider } from "./auth/PermissionProvider";
import { IntlSetup } from "./i18n/IntlSetup";
import { App } from "./App";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <AuthProvider>
      <IntlSetup>
        <BrowserRouter>
          <PermissionProvider>
            <App />
          </PermissionProvider>
        </BrowserRouter>
      </IntlSetup>
    </AuthProvider>
  </StrictMode>,
);
