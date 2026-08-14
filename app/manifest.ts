import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Balloon Companion",
    short_name: "Balloon Companion",
    description: "Le copilote numérique des pilotes de montgolfière.",
    start_url: "/",
    display: "standalone",
    background_color: "#020817",
    theme_color: "#020817",
  };
}
