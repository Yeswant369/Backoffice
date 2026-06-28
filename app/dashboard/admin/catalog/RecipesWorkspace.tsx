"use client";

import SheetWorkspace from "./SheetWorkspace";
import { importRecipesFromGrid } from "./actions";

const STARTER_HEADERS = [
  "Name",
  "Category",
  "Selling Price",
  "Yield Portions",
  "Overhead %",
  "Date",
];

interface Props {
  connected: boolean;
  sheetUrl: string;
}

export default function RecipesWorkspace({ connected, sheetUrl }: Props) {
  return (
    <SheetWorkspace
      purpose="recipes"
      title="Recipes Workspace"
      description="A customizable grid synced to the location's Google Sheet."
      defaultTab="Recipes"
      starterHeaders={STARTER_HEADERS}
      connected={connected}
      sheetUrl={sheetUrl}
      importLabel="Recipes"
      importAction={importRecipesFromGrid}
    />
  );
}
