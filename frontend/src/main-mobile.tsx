import { initShell } from "./mobile/shell";
initShell();

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./mobile/App";
import "./mobile/styles/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
