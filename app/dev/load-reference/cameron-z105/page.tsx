import { notFound } from "next/navigation";
import CameronZ105ReferenceWorkbench from "./CameronZ105ReferenceWorkbench";

export default function CameronZ105ReferencePage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <CameronZ105ReferenceWorkbench />;
}
