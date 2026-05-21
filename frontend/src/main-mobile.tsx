import { initShell } from "./mobile/shell";
import "./mobile/styles/index.css";

// initShell() must run BEFORE App module is evaluated,
// because App captures window.amtodoShell at module top level.
initShell();

Promise.all([
  import("react"),
  import("react-dom/client"),
  import("./mobile/App"),
]).then(([react, client, app]) => {
  client.createRoot(document.getElementById("root")!).render(
    react.createElement(react.StrictMode, null,
      react.createElement(app.App)
    )
  );
});
