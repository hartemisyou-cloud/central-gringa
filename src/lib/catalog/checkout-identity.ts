import type { HhbProduct } from "./hhb";
import { workById } from "./hhb";
import coverTomSawyer from "@/assets/covers/tom-sawyer.jpg";
import coverLittleWomen from "@/assets/covers/little-women.jpg";
import coverHuckleberryFinn from "@/assets/covers/huckleberry-finn.jpg";
import coverMobyDick from "@/assets/covers/moby-dick.jpg";
import coverClassicsCollection from "@/assets/covers/classics-collection.jpg";
import coverClassicsLibrary from "@/assets/covers/classics-library.jpg";

/** The same existing cover assets used by the storefront, emitted by Vite. */
const covers: Record<string, string> = {
  "HHB-EB-020": coverTomSawyer,
  "HHB-EB-030": coverLittleWomen,
  "HHB-EB-050": coverHuckleberryFinn,
  "HHB-EB-100": coverMobyDick,
  "HHB-COL-250": coverClassicsCollection,
  "HHB-LIB-500": coverClassicsLibrary,
};

export function ebookCheckoutIdentity(product: HhbProduct, origin: string) {
  const cover = covers[product.sku];
  const works = product.workIds.map(workById);
  if (!cover || works.some(work => !work) || works.length === 0) {
    throw new Error("Checkout product identity is incomplete.");
  }
  const authors = [...new Set(works.map(work => work!.author))];
  const fullDescription = `E-book · ${authors.join(", ")}`;
  return {
    name: product.name,
    description: fullDescription.length > 90
      ? `E-book · ${authors.slice(0, 2).join(", ")} e outros`
      : fullDescription,
    images: [new URL(cover, origin).href],
  };
}
