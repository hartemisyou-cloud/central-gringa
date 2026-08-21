import { resendUtmifySaleForOrderNumber } from "./src/lib/utmify/api.server";
console.log(JSON.stringify(await resendUtmifySaleForOrderNumber("ORD-20260821-QQJUZZ"), null, 2));
