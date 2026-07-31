import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/me";

// output: "export" 下这类约定文件要显式声明，否则构建期报错。
// 它本来也就是构建期生成的，声明只是把事实写出来
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
