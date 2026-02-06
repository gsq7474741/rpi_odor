// @deprecated 此页面已迁移到 /data-center，请使用新路由
// 保留此文件用于向后兼容，访问 /experiments 会自动重定向到 /data-center
// 原始代码已移至 /data-center/page.tsx
import { redirect } from "next/navigation";

export default function ExperimentsPageDeprecated() {
  redirect("/data-center");
}
