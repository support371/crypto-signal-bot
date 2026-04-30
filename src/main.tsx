import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { logFrontendEnvWarnings } from "./lib/env";

logFrontendEnvWarnings();

createRoot(document.getElementById("root")!).render(<App />);
