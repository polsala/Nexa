import { createUniver } from "./bootstrap";
import { UniverSheetsCoreWorkerPreset } from "@univerjs/preset-sheets-core/worker";
createUniver({ presets: [UniverSheetsCoreWorkerPreset()] });
