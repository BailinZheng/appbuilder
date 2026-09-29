import { ImageResponse } from "next/og";
import { getPublishedApp } from "../data";

// Generated app icon: first letter of the app name on the brand colour.
export async function GET(req: Request, ctx: RouteContext<"/s/[slug]/app-icon">) {
  const { slug } = await ctx.params;
  const app = await getPublishedApp(slug);
  if (!app) return new Response("Not found", { status: 404 });
  const requested = Number(new URL(req.url).searchParams.get("size"));
  const size = [180, 192, 512].includes(requested) ? requested : 192;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: app.themeColor,
          color: "white",
          fontSize: size * 0.5,
          fontWeight: 700,
        }}
      >
        {app.name.trim().charAt(0).toUpperCase() || "A"}
      </div>
    ),
    { width: size, height: size },
  );
}
