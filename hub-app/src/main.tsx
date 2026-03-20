import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { AuthProvider } from "./auth/AuthProvider";
import { PermissionProvider } from "./auth/PermissionProvider";
import { IntlSetup } from "./i18n/IntlSetup";
import { ThemeProvider } from "./theme/ThemeProvider";
import { App } from "./App";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <PermissionProvider>
          <IntlSetup>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </IntlSetup>
        </PermissionProvider>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
