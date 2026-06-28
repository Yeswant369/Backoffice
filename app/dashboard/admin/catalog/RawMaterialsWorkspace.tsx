"use client";

import SheetWorkspace from "./SheetWorkspace";
import { importMaterialsFromGrid } from "./actions";

const STARTER_HEADERS = [
  "Name",
  "Brand",
  "Purchase Unit",
  "Stock Unit",
  "Conversion Factor",
  "Par Level",
  "Category",
  "Date",
];

interface Props {
  connected: boolean;
  sheetUrl: string;
}

export default function RawMaterialsWorkspace({ connected, sheetUrl }: Props) {
  return (
    <SheetWorkspace
      purpose="materials"
      title="Raw Materials Workspace"
      description="A customizable grid synced to the location's Google Sheet."
      defaultTab="Raw Materials"
      starterHeaders={STARTER_HEADERS}
      connected={connected}
      sheetUrl={sheetUrl}
      importLabel="Raw Materials"
      importAction={importMaterialsFromGrid}
    />
  );
}
